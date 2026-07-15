import { NextResponse } from 'next/server'
import { supabase, queryWithRetry } from '@/lib/supabase'

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
    let tracksQuery = supabase
      .from('tracks')
      .select(
        'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url'
      )

    const sanitizedExclusions = (excludedTrackIds ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
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
