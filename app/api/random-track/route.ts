import { NextResponse } from 'next/server'
import { supabase, queryWithRetry } from '@/lib/supabase'
import { getRecentlyPlayed } from '@/services/aiSuggestion'
import { pickWeightedSuggestedTrack } from '@/services/suggestedTrackPicker'

const TRACK_COLUMNS =
  'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url'

// suggested_tracks is small (hundreds of rows per venue); cap the read anyway,
// keeping the most recently suggested rows.
const SUGGESTED_POOL_LIMIT = 2000

interface RandomTrack {
  id: string
  spotify_track_id: string
  name: string
  artist: string
  album: string
  duration_ms: number
  popularity: number
  spotify_url: string | null
}

interface SuggestedPoolRow {
  count: number
  last_suggested_at: string
  tracks: RandomTrack | null
}

// Weighted random pick biased toward more popular tracks, instead of a
// uniform pick — degrades the AI-suggestion fallback more gracefully than
// picking a totally arbitrary track. `popularity + 1` keeps zero-popularity
// (cache-only) tracks pickable, just unlikely.
function pickWeightedByPopularity<T extends { popularity: number | null }>(
  tracks: T[]
): T {
  const weights = tracks.map((t) => Math.max(t.popularity ?? 0, 0) + 1)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  let roll = Math.random() * totalWeight
  for (let i = 0; i < tracks.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return tracks[i]
  }
  return tracks[tracks.length - 1]
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      username?: string
      excludedTrackIds?: string[]
    }
    const { username, excludedTrackIds } = body

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      )
    }

    // Get the profile ID for the username
    const profileResult = await queryWithRetry<{
      id: string
    }>(
      supabase
        .from('profiles')
        .select('id')
        .ilike('display_name', username)
        .single<{ id: string }>(),
      undefined,
      `Fetch profile for username: ${username}`
    )

    const profile = profileResult.data
    const profileError = profileResult.error

    if (profileError ?? !profile) {
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    // Exclude already-queued/recently-played tracks at the query level so the
    // LIMIT is applied AFTER exclusion — otherwise an arbitrary, unordered
    // 50-row slice could happen to be dominated by excluded tracks and starve
    // out eligible tracks that exist elsewhere in a larger catalog.
    let tracksQuery = supabase.from('tracks').select(TRACK_COLUMNS)

    // The caller only knows about the current queue; the last 100 played
    // tracks must also never be auto-added, so merge them in server-side.
    const recentlyPlayed = await getRecentlyPlayed(profile.id)
    // Guard the shape: spreading a non-array (e.g. a string) would silently
    // become one-character "IDs" and exclude nothing.
    const requestedExclusions = Array.isArray(excludedTrackIds)
      ? excludedTrackIds
      : []
    const sanitizedExclusions = Array.from(
      new Set([
        ...requestedExclusions,
        ...recentlyPlayed.map((entry) => entry.spotifyTrackId)
      ])
    ).filter((id): id is string => typeof id === 'string' && id.length > 0)

    // Preferred source: tracks human users have suggested at this venue,
    // weighted toward ones suggested more often and more recently. Filtering
    // happens in memory (the pool is small) so the exclusion list can't bloat
    // the query string.
    const excludedSet = new Set(sanitizedExclusions)
    const suggestedResult = await queryWithRetry<SuggestedPoolRow[]>(
      supabase
        .from('suggested_tracks')
        .select(`count, last_suggested_at, tracks:track_id(${TRACK_COLUMNS})`)
        .eq('profile_id', profile.id)
        .order('last_suggested_at', { ascending: false })
        .limit(SUGGESTED_POOL_LIMIT)
        .returns<SuggestedPoolRow[]>(),
      undefined,
      'Fetch human-suggested tracks for fallback'
    )

    if (suggestedResult.error) {
      // Non-fatal: fall through to the general catalog below.
      console.warn(
        'random-track: failed to read suggested_tracks, using catalog fallback'
      )
    }

    const suggestedCandidates = (suggestedResult.data ?? [])
      .filter(
        (row) =>
          row.tracks !== null &&
          !excludedSet.has(row.tracks.spotify_track_id) &&
          !!row.tracks.spotify_url
      )
      .map((row) => ({
        track: row.tracks as RandomTrack,
        count: row.count,
        lastSuggestedAt: row.last_suggested_at
      }))

    const suggestedTrack = pickWeightedSuggestedTrack(suggestedCandidates)
    if (suggestedTrack) {
      return NextResponse.json({
        success: true,
        track: suggestedTrack,
        pool: 'suggested'
      })
    }

    // Last resort (no eligible human-suggested tracks, e.g. a venue with no
    // request history yet): pick from the general catalog so the queue never
    // starves.
    if (sanitizedExclusions.length > 0) {
      const literalList = sanitizedExclusions
        .map((id) => `"${id.replace(/"/g, '\\"')}"`)
        .join(',')
      tracksQuery = tracksQuery.not(
        'spotify_track_id',
        'in',
        `(${literalList})`
      )
    }

    const tracksResult = await queryWithRetry<
      Array<{
        id: string
        spotify_track_id: string
        name: string
        artist: string
        album: string
        duration_ms: number
        popularity: number
        spotify_url: string | null
      }>
    >(
      // Order by popularity first so the LIMIT slice is the most popular
      // eligible tracks, not an arbitrary/unordered 50 rows.
      tracksQuery.order('popularity', { ascending: false }).limit(50),
      undefined,
      'Fetch tracks for random selection'
    )

    const availableTracks = tracksResult.data
    const tracksError = tracksResult.error

    if (tracksError) {
      return NextResponse.json(
        { error: 'Failed to get tracks from database' },
        { status: 500 }
      )
    }

    if (!availableTracks || availableTracks.length === 0) {
      return NextResponse.json(
        { error: 'No tracks available in database after exclusion' },
        { status: 404 }
      )
    }

    // Pick a track weighted toward higher popularity, rather than uniformly
    const randomTrack = pickWeightedByPopularity(availableTracks)
    return NextResponse.json({
      success: true,
      track: randomTrack
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
