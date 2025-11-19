import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabase, queryWithRetry } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { parseWithType } from '@/shared/types/utils'
import type { JukeboxQueueItem } from '@/shared/types/queue'

const logger = createModuleLogger('API Playlist')

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const username = params.id

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
      logger(
        'ERROR',
        `Failed to fetch profile for username: ${username}`,
        undefined,
        (profileError as Error | null) ?? new Error('No profile returned')
      )
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    const queueResult = await queryWithRetry<JukeboxQueueItem[]>(
      supabase
        .from('jukebox_queue')
        .select(
          'id, profile_id, track_id, votes, queued_at, tracks:track_id(*)'
        )
        .eq('profile_id', profile.id)
        .order('votes', { ascending: false })
        .order('queued_at', { ascending: true })
        .returns<JukeboxQueueItem[]>(),
      undefined,
      `Fetch jukebox queue for profileId: ${profile.id}`
    )

    const data = queueResult.data
    const error = queueResult.error

    if (error) {
      logger(
        'ERROR',
        `Failed to fetch jukebox queue for profileId: ${profile.id}`,
        JSON.stringify({ profileId: profile.id, error }),
        error as Error
      )
      return NextResponse.json(
        { error: 'Failed to fetch jukebox queue' },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    logger(
      'ERROR',
      'Unexpected error in GET handler',
      undefined,
      error as Error
    )
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

const addTrackSchema = z.object({
  tracks: z.object({
    id: z.string(),
    name: z.string(),
    artists: z.array(z.object({ name: z.string() })),
    album: z.object({ name: z.string() }),
    duration_ms: z.number(),
    popularity: z.number(),
    uri: z.string()
  }),
  initialVotes: z.number().optional(),
  source: z.enum(['user', 'system', 'admin', 'fallback']).default('user')
})

type AddTrackResponseBody =
  | { message: string }
  | { error: string; details?: string }
  | { error: z.ZodIssue[] }

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse<AddTrackResponseBody>> {
  try {
    const username = params.id
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
      logger(
        'ERROR',
        `Failed to fetch profile for username: ${username}`,
        undefined,
        (profileError as Error | null) ?? new Error('No profile returned')
      )
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    const body = (await request.json()) as unknown
    const parsed = parseWithType(addTrackSchema, body)
    const { tracks, initialVotes, source } = parsed
    const requestSource = source ?? 'user'

    // Fetch detailed track information from Spotify API to get release date and genre
    let detailedTrackInfo: {
      album?: { release_date?: string }
      artists?: Array<{ id: string; name: string }>
    } | null = null
    let artistGenres: string[] = []

    try {
      // Get admin profile for Spotify API access
      const adminResult = await queryWithRetry<{
        spotify_access_token: string | null
        spotify_refresh_token: string | null
        spotify_token_expires_at: number | null
      }>(
        supabase
          .from('profiles')
          .select(
            'spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
          )
          .ilike('display_name', '3B')
          .single(),
        undefined,
        'Fetch admin profile for Spotify API access'
      )

      const adminProfile = adminResult.data
      const adminError = adminResult.error

      if (!adminError && adminProfile?.spotify_access_token) {
        // First, get track details (includes artist ID but not genres)
        const trackResponse = await fetch(
          `https://api.spotify.com/v1/tracks/${tracks.id}`,
          {
            headers: {
              Authorization: `Bearer ${adminProfile.spotify_access_token}`
            }
          }
        )

        if (trackResponse.ok) {
          detailedTrackInfo = (await trackResponse.json()) as {
            album?: { release_date?: string }
            artists?: Array<{ id: string; name: string }>
          }

          // Then, get artist genres if we have an artist ID
          if (detailedTrackInfo?.artists?.[0]?.id) {
            const artistId = detailedTrackInfo.artists[0].id
            const artistResponse = await fetch(
              `https://api.spotify.com/v1/artists/${artistId}`,
              {
                headers: {
                  Authorization: `Bearer ${adminProfile.spotify_access_token}`
                }
              }
            )
            if (artistResponse.ok) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const artistData = await artistResponse.json()
              artistGenres = (artistData as { genres?: string[] }).genres ?? []
            }
          }
        }
      }
    } catch (error) {
      logger(
        'ERROR',
        `Playlist API - Error fetching detailed track info`,
        undefined,
        error as Error
      )
      // Continue without detailed info
    }

    // Extract release year and genre from detailed track info
    const releaseYear = detailedTrackInfo?.album?.release_date
      ? new Date(detailedTrackInfo.album.release_date).getFullYear()
      : new Date().getFullYear()

    const genre = artistGenres[0] ?? null

    // Safeguard: Validate that the Spotify track ID is not a UUID and is the correct format

    if (
      tracks.id.includes('-') || // UUIDs have hyphens
      tracks.id.length !== 22 || // Spotify track IDs are always 22 chars
      !/^[0-9A-Za-z]+$/.test(tracks.id) // Only alphanumeric
    ) {
      logger('ERROR', `Invalid Spotify track ID: ${tracks.id}`)
      logger(
        'ERROR',
        `Track ID validation failed - length: ${tracks.id.length}, contains hyphens: ${tracks.id.includes('-')}, alphanumeric: ${!/^[0-9A-Za-z]+$/.test(tracks.id)}`
      )
      return NextResponse.json(
        { error: 'Invalid Spotify track ID provided' },
        { status: 400 }
      )
    }

    const upsertResult = await queryWithRetry<{
      id: string
    }>(
      supabase
        .from('tracks')
        .upsert(
          {
            spotify_track_id: tracks.id,
            name: tracks.name,
            artist: tracks.artists[0].name,
            album: tracks.album.name,
            duration_ms: tracks.duration_ms,
            popularity: tracks.popularity,
            spotify_url: tracks.uri,
            genre: genre,
            release_year: releaseYear
          },
          { onConflict: 'spotify_track_id' }
        )
        .select('id')
        .single(),
      undefined,
      `Upsert track with Spotify ID: ${tracks.id}`
    )

    const upsertedTrack = upsertResult.data
    const upsertError = upsertResult.error

    if (upsertError ?? !upsertedTrack) {
      logger('ERROR', `Upsert error details: ${JSON.stringify(upsertError)}`)
      logger(
        'ERROR',
        `Track data that failed: ${JSON.stringify({
          spotify_track_id: tracks.id,
          name: tracks.name,
          artist: tracks.artists[0].name,
          album: tracks.album.name,
          duration_ms: tracks.duration_ms,
          popularity: tracks.popularity,
          spotify_url: tracks.uri
        })}`
      )
      logger(
        'ERROR',
        `Failed to upsert track with Spotify ID: ${tracks.id}`,
        undefined,
        (upsertError as Error | null) ??
          new Error('No track returned from upsert')
      )
      return NextResponse.json(
        { error: `Failed to save track with Spotify ID ${tracks.id}` },
        { status: 500 }
      )
    }

    // Check if track is already in the users queue
    const checkResult = await queryWithRetry<{
      id: string
      tracks: {
        spotify_track_id: string
        name: string
      }
    }>(
      supabase
        .from('jukebox_queue')
        .select('id, tracks:track_id(spotify_track_id, name)')
        .eq('profile_id', profile.id)
        .eq('track_id', upsertedTrack.id)
        .single(),
      undefined,
      `Check for duplicate track in queue for profileId: ${profile.id}`
    )

    const existingQueueItem = checkResult.data
    const checkError = checkResult.error

    if (
      checkError &&
      typeof checkError === 'object' &&
      'code' in checkError &&
      checkError.code !== 'PGRST116'
    ) {
      // PGRST116 not found which is expected
      logger(
        'ERROR',
        `Error checking for duplicate track: ${JSON.stringify(checkError)}`
      )
      return NextResponse.json(
        { error: 'Failed to check for duplicate track' },
        { status: 500 }
      )
    }

    if (existingQueueItem) {
      logger(
        'WARN',
        `Track ${tracks.name} (${tracks.id}) is already in the queue for user ${username}`
      )
      return NextResponse.json(
        { error: 'This track is already in your playlist' },
        { status: 409 }
      )
    }

    const insertResult = await queryWithRetry(
      supabase.from('jukebox_queue').insert({
        profile_id: profile.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        track_id: upsertedTrack.id,
        votes: initialVotes ?? 5
      }),
      undefined,
      `Insert track into jukebox queue for profileId: ${profile.id}`
    )

    const insertError = insertResult.error

    if (insertError) {
      logger(
        'ERROR',
        `Queue insert error details: ${JSON.stringify(insertError)}`
      )
      logger(
        'ERROR',
        'Failed to insert track into jukebox queue',
        undefined,
        insertError as Error
      )
      return NextResponse.json(
        { error: 'Failed to add track to queue' },
        { status: 500 }
      )
    }

    // Only log track suggestions for user-initiated requests
    if (requestSource === 'user') {
      // Log the track suggestion for analytics
      const logResult = await queryWithRetry(
        supabase.rpc('log_track_suggestion', {
          p_profile_id: profile.id,
          p_spotify_track_id: tracks.id,
          p_track_name: tracks.name,
          p_artist_name: tracks.artists[0].name,
          p_album_name: tracks.album.name,
          p_duration_ms: tracks.duration_ms,
          p_popularity: tracks.popularity,
          p_spotify_url: tracks.uri,
          p_genre: genre, // Use the genre we fetched from detailed track info
          p_release_year: releaseYear // Use the release year we extracted from detailed track info
        }),
        undefined,
        `Log track suggestion for profileId: ${profile.id}`
      )

      const logError = logResult.error

      if (logError) {
        logger(
          'ERROR',
          `Track suggestion logging error: ${JSON.stringify(logError)}`
        )
        logger(
          'ERROR',
          'Failed to log track suggestion',
          undefined,
          logError as Error
        )
        // Don't fail the entire request if logging fails, just log the error
      }
    }

    return NextResponse.json({ message: 'Track added to queue successfully' })
  } catch (error) {
    logger(
      'ERROR',
      `Playlist API - Full error details: ${JSON.stringify(error)}`
    )
    logger('ERROR', 'Error in POST handler', undefined, error as Error)
    if (error instanceof z.ZodError) {
      logger(
        'ERROR',
        `Playlist API - Zod validation error: ${JSON.stringify(error.issues)}`
      )
      const errorMessage = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ')
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred'
    logger('ERROR', `Playlist API - Error message: ${errorMessage}`)
    return NextResponse.json(
      { error: 'Failed to add track to queue', details: errorMessage },
      { status: 500 }
    )
  }
}
