import Anthropic from '@anthropic-ai/sdk'
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

const CLAUDE_MODEL = 'claude-sonnet-4-6'

const SYSTEM_MESSAGE = `You are an expert music curator for a bar and venue jukebox system.
Your job is to suggest exactly ${SUGGESTION_BATCH_SIZE} songs that match the requested vibe.

Rules:
- Return ONLY a valid JSON array — no explanation, no markdown, no other text
- Each entry must have exactly two fields: "title" and "artist"
- Maximum 1 song per artist — every suggestion must be from a different artist
- Mix well-known hits with deeper cuts; avoid the most overplayed, obvious choices for the genre
- Include songs from different decades and subgenres within the vibe unless the prompt specifies otherwise
- Do NOT suggest songs from the recently played or queued list provided by the user
- Choose songs that are widely available on Spotify

Format: [{"title": "Song Name", "artist": "Artist Name"}, ...]`

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
    message +=
      '\n\nDo NOT suggest any of these recently played or currently queued songs:'
    allExcluded.forEach((entry, i) => {
      message += `\n${i + 1}. "${entry.title}" by ${entry.artist}`
    })
  }

  message += `\n\nReturn a JSON array like: [{"title": "Song Name", "artist": "Artist Name"}, ...]`

  return message
}

export function parseAiResponse(raw: string): AiSongRecommendation[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    logger('WARN', 'No JSON array found in Claude response')
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    logger('WARN', 'Failed to parse JSON from Claude response')
    return []
  }

  if (!Array.isArray(parsed)) {
    logger('WARN', 'Parsed Claude response is not an array')
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

async function spotifySearch(
  query: string,
  token: string
): Promise<string | null> {
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1&market=VN`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  })
  if (!response.ok) return null
  const data = (await response.json()) as SpotifySearchResponse
  return data.tracks?.items?.[0]?.id ?? null
}

export async function resolveToSpotifyTrack(
  title: string,
  artist: string
): Promise<string | null> {
  try {
    const token = await getAppAccessToken()

    // Try structured query first; fall back to plain text for non-Latin scripts
    const structuredId = await spotifySearch(
      buildSpotifySearchQuery(title, artist),
      token
    )
    if (structuredId) return structuredId

    const plainId = await spotifySearch(`${title} ${artist}`, token)
    if (plainId) {
      logger('INFO', `Resolved "${title}" by ${artist} via plain-text fallback`)
      return plainId
    }

    logger('WARN', `No Spotify result for "${title}" by ${artist}`)
    return null
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
  if (!process.env.ANTHROPIC_API_KEY) {
    logger('ERROR', 'Anthropic API key is not configured')
    return { tracks: [], failedResolutions: [] }
  }

  const userMessage = buildUserMessage(prompt, recentlyPlayed, queuedTracks)

  logger(
    'INFO',
    `Requesting AI suggestions for prompt: "${prompt.slice(0, 80)}..."`
  )

  const recentlyPlayedIds = new Set(recentlyPlayed.map((e) => e.spotifyTrackId))
  const excludedSet = new Set(excludedTrackIds)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let content: string
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      temperature: 1.0,
      system: SYSTEM_MESSAGE,
      messages: [{ role: 'user', content: userMessage }]
    })

    const block = message.content[0]
    if (block.type !== 'text') {
      logger('WARN', 'Claude returned non-text content block')
      return { tracks: [], failedResolutions: [] }
    }
    content = block.text
  } catch (error) {
    logger(
      'ERROR',
      'Failed to contact Claude API',
      undefined,
      error instanceof Error ? error : undefined
    )
    return { tracks: [], failedResolutions: [] }
  }

  if (!content) {
    logger('WARN', 'Claude returned empty content')
    return { tracks: [], failedResolutions: [] }
  }

  const recommendations = parseAiResponse(content)

  if (recommendations.length === 0) {
    logger('WARN', 'Claude returned no valid recommendations')
    return { tracks: [], failedResolutions: [] }
  }

  if (recommendations.length < SUGGESTION_BATCH_SIZE) {
    logger(
      'INFO',
      `Claude returned ${recommendations.length}/${SUGGESTION_BATCH_SIZE} recommendations, proceeding with partial batch`
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

const RECENTLY_PLAYED_LIMIT = 500

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
