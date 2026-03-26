import { createModuleLogger } from '@/shared/utils/logger'
import { getAppAccessToken } from '@/services/spotify/auth'
import { supabase } from '@/lib/supabase'
import type {
  AiSongRecommendation,
  AiSuggestionResult,
  RecentlyPlayedEntry
} from '@/shared/types/aiSuggestions'
import { SUGGESTION_BATCH_SIZE } from '@/shared/constants/aiSuggestion'

const logger = createModuleLogger('AISuggestion')

const VENICE_API_URL = 'https://api.venice.ai/api/v1/chat/completions'
const VENICE_MODEL = 'llama-3.3-70b'
const FETCH_TIMEOUT_MS = 25000

const SYSTEM_MESSAGE = `You are a music recommendation engine. Return exactly ${SUGGESTION_BATCH_SIZE} song suggestions as a JSON array.
Each entry must have "title" and "artist" fields. Return ONLY the JSON array, no other text.
Do not include songs from the recently played list provided by the user.`

export function buildUserMessage(
  prompt: string,
  recentlyPlayed: RecentlyPlayedEntry[],
  queuedTracks: Array<{ title: string; artist: string }> = []
): string {
  let message = `Suggest ${SUGGESTION_BATCH_SIZE} songs matching this vibe: ${prompt}`

  const allExcluded = [
    ...recentlyPlayed.map((e) => ({ title: e.title, artist: e.artist })),
    ...queuedTracks
  ]

  if (allExcluded.length > 0) {
    message += '\n\nDo NOT suggest any of these recently played or currently queued songs:'
    allExcluded.forEach((entry, i) => {
      message += `\n${i + 1}. "${entry.title}" by ${entry.artist}`
    })
  }

  message += `\n\nReturn a JSON array like: [{"title": "Song Name", "artist": "Artist Name"}, ...]`

  return message
}

export function parseVeniceResponse(raw: string): AiSongRecommendation[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    logger('WARN', 'No JSON array found in Venice AI response')
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    logger('WARN', 'Failed to parse JSON from Venice AI response')
    return []
  }

  if (!Array.isArray(parsed)) {
    logger('WARN', 'Parsed Venice AI response is not an array')
    return []
  }

  const recommendations: AiSongRecommendation[] = []
  for (const item of parsed) {
    if (
      item !== null &&
      typeof item === 'object' &&
      'title' in item &&
      'artist' in item
    ) {
      const record = item as Record<string, unknown>
      const title = record.title
      const artist = record.artist
      if (
        typeof title === 'string' &&
        typeof artist === 'string' &&
        title.trim().length > 0 &&
        artist.trim().length > 0
      ) {
        recommendations.push({
          title: title.trim(),
          artist: artist.trim()
        })
      }
    }
  }

  return recommendations
}

export function buildSpotifySearchQuery(title: string, artist: string): string {
  return `track:${title} artist:${artist}`
}

interface SpotifySearchResponse {
  tracks: {
    items: Array<{
      id: string
      name: string
      artists: Array<{ name: string }>
    }>
  }
}

export async function resolveToSpotifyTrack(
  title: string,
  artist: string
): Promise<string | null> {
  const query = buildSpotifySearchQuery(title, artist)
  try {
    const token = await getAppAccessToken()
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1&market=VN`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      logger(
        'WARN',
        `Spotify search failed for "${title}" by ${artist}: ${response.status}`
      )
      return null
    }
    const data = (await response.json()) as SpotifySearchResponse
    const firstTrack = data.tracks?.items?.[0]
    if (!firstTrack) {
      logger('WARN', `No Spotify result for "${title}" by ${artist}`)
      return null
    }
    return firstTrack.id
  } catch (error) {
    logger(
      'WARN',
      `Failed to resolve "${title}" by ${artist} on Spotify`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return null
  }
}

export async function getAiSuggestions(
  prompt: string,
  excludedTrackIds: string[],
  recentlyPlayed: RecentlyPlayedEntry[],
  queuedTracks: Array<{ title: string; artist: string }> = []
): Promise<AiSuggestionResult> {
  const apiKey = process.env.VENICE_AI_API_KEY
  if (!apiKey) {
    logger('ERROR', 'Venice AI API key is not configured')
    return { tracks: [], failedResolutions: [] }
  }

  const userMessage = buildUserMessage(prompt, recentlyPlayed, queuedTracks)

  logger(
    'INFO',
    `Requesting AI suggestions for prompt: "${prompt.slice(0, 80)}..."`
  )

  const recentlyPlayedIds = new Set(recentlyPlayed.map((e) => e.spotifyTrackId))
  const excludedSet = new Set(excludedTrackIds)

  let veniceResponse: Response
  try {
    veniceResponse = await fetch(VENICE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        model: VENICE_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 1000
      })
    })
  } catch (error) {
    const isTimeout =
      error instanceof DOMException && error.name === 'TimeoutError'
    logger(
      'ERROR',
      isTimeout
        ? 'Venice AI request timed out after 25 seconds'
        : 'Failed to contact Venice AI',
      undefined,
      error instanceof Error ? error : undefined
    )
    return { tracks: [], failedResolutions: [] }
  }

  if (!veniceResponse.ok) {
    const errorBody = await veniceResponse.text().catch(() => 'unknown')
    logger(
      'ERROR',
      `Venice AI returned status ${veniceResponse.status}: ${errorBody.slice(0, 200)}`
    )
    return { tracks: [], failedResolutions: [] }
  }

  let data: { choices?: Array<{ message?: { content?: string } }> }
  try {
    data = (await veniceResponse.json()) as typeof data
  } catch {
    logger('ERROR', 'Failed to parse Venice AI JSON response')
    return { tracks: [], failedResolutions: [] }
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    logger('WARN', 'Venice AI returned empty content')
    return { tracks: [], failedResolutions: [] }
  }

  const recommendations = parseVeniceResponse(content)

  if (recommendations.length === 0) {
    logger('WARN', 'Venice AI returned no valid recommendations')
    return { tracks: [], failedResolutions: [] }
  }

  if (recommendations.length < SUGGESTION_BATCH_SIZE) {
    logger(
      'INFO',
      `Venice AI returned ${recommendations.length}/${SUGGESTION_BATCH_SIZE} recommendations, proceeding with partial batch`
    )
  }

  // Resolve each recommendation to a Spotify track ID
  const tracks: AiSuggestionResult['tracks'] = []
  const failedResolutions: AiSuggestionResult['failedResolutions'] = []

  for (const rec of recommendations) {
    const spotifyTrackId = await resolveToSpotifyTrack(rec.title, rec.artist)
    if (!spotifyTrackId) {
      failedResolutions.push({
        title: rec.title,
        artist: rec.artist,
        reason: 'No Spotify match found'
      })
      continue
    }

    if (
      recentlyPlayedIds.has(spotifyTrackId) ||
      excludedSet.has(spotifyTrackId)
    ) {
      logger(
        'INFO',
        `Filtered out "${rec.title}" by ${rec.artist} (already played or excluded)`
      )
      continue
    }

    tracks.push({
      spotifyTrackId,
      title: rec.title,
      artist: rec.artist
    })
  }

  logger(
    'INFO',
    `Resolved ${tracks.length} tracks, ${failedResolutions.length} failed`
  )

  return { tracks, failedResolutions }
}

const RECENTLY_PLAYED_LIMIT = 100

async function resolveProfileId(usernameOrId: string): Promise<string> {
  // If it looks like a UUID, use it directly
  if (usernameOrId.includes('-') && usernameOrId.length > 30) {
    return usernameOrId
  }
  // Otherwise resolve username to profile UUID
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('profiles')
    .select('id')
    .ilike('display_name', usernameOrId)
    .single()
  return (data as { id: string } | null)?.id ?? usernameOrId
}

// Table type not yet in generated Supabase types (migration in task 4.1)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recentlyPlayedTable = () =>
  (supabase as any).from('recently_played_tracks')

interface RecentlyPlayedRow {
  spotify_track_id: string
  title: string
  artist: string
  played_at: string
}

export async function getRecentlyPlayed(
  profileId: string
): Promise<RecentlyPlayedEntry[]> {
  try {
    const resolvedId = await resolveProfileId(profileId)
    const { data, error } = await recentlyPlayedTable()
      .select('spotify_track_id, title, artist')
      .eq('profile_id', resolvedId)
      .order('played_at', { ascending: false })
      .limit(RECENTLY_PLAYED_LIMIT)

    if (error) {
      logger('WARN', `Failed to read recently played tracks: ${error.message}`)
      return []
    }

    return ((data as RecentlyPlayedRow[]) ?? []).map((row) => ({
      spotifyTrackId: row.spotify_track_id,
      title: row.title,
      artist: row.artist
    }))
  } catch (error) {
    logger(
      'WARN',
      'Unexpected error reading recently played tracks',
      undefined,
      error instanceof Error ? error : undefined
    )
    return []
  }
}

export async function addToRecentlyPlayed(
  profileId: string,
  entry: RecentlyPlayedEntry
): Promise<void> {
  try {
    const resolvedId = await resolveProfileId(profileId)
    const { error: upsertError } = await recentlyPlayedTable().upsert(
      {
        profile_id: resolvedId,
        spotify_track_id: entry.spotifyTrackId,
        title: entry.title,
        artist: entry.artist,
        played_at: new Date().toISOString()
      },
      { onConflict: 'profile_id,spotify_track_id' }
    )

    if (upsertError) {
      logger(
        'WARN',
        `Failed to upsert recently played track: ${upsertError.message}`
      )
      return
    }

    // Delete oldest entries beyond the limit
    const { data: rows, error: fetchError } = await recentlyPlayedTable()
      .select('played_at')
      .eq('profile_id', resolvedId)
      .order('played_at', { ascending: false })
      .range(RECENTLY_PLAYED_LIMIT - 1, RECENTLY_PLAYED_LIMIT - 1)

    if (fetchError) {
      logger(
        'WARN',
        `Failed to check recently played count: ${fetchError.message}`
      )
      return
    }

    const typedRows = rows as RecentlyPlayedRow[] | null
    if (typedRows && typedRows.length > 0) {
      const cutoff = typedRows[0].played_at
      const { error: deleteError } = await recentlyPlayedTable()
        .delete()
        .eq('profile_id', resolvedId)
        .lt('played_at', cutoff)

      if (deleteError) {
        logger(
          'WARN',
          `Failed to trim recently played tracks: ${deleteError.message}`
        )
      }
    }
  } catch (error) {
    logger(
      'WARN',
      'Unexpected error adding to recently played tracks',
      undefined,
      error instanceof Error ? error : undefined
    )
  }
}
