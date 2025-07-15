/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { parseWithType } from '@/shared/types/utils'

const logger = createModuleLogger('API Playlist')

interface Track {
  id: string
  spotify_track_id: string
  name: string
  artist: string
  album: string
  duration_ms: number
  popularity: number
  spotify_uri: string
}

interface JukeboxQueueItem {
  id: string
  profile_id: string
  track_id: string
  votes: number
  queued_at: string
  tracks: Track
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const username = params.id

    logger('INFO', `Username: ${username}`)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('display_name', username)
      .single<{ id: string }>()

    logger('INFO', `Profile from Supabase: ${JSON.stringify(profile)}`)
    if (profileError || !profile) {
      logger(
        'ERROR',
        `Failed to fetch profile for username: ${username}`,
        undefined,
        profileError || new Error('No profile returned')
      )
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    logger('INFO', `Using profile.id for queue query: ${profile.id}`)
    const { data, error } = await supabase
      .from('jukebox_queue')
      .select('id, profile_id, track_id, votes, queued_at, tracks:track_id(*)')
      .eq('profile_id', profile.id)
      .order('votes', { ascending: false })
      .order('queued_at', { ascending: true })
      .returns<JukeboxQueueItem[]>()

    logger('INFO', `Raw queue data from Supabase: ${JSON.stringify(data)}`)
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

    logger('INFO', `Final queue object: ${JSON.stringify(data)}`)
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

const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })).min(1),
  album: z.object({
    name: z.string()
  }),
  duration_ms: z.number(),
  popularity: z.number(),
  uri: z.string()
})

const addTrackSchema = z.object({
  tracks: trackSchema,
  initialVotes: z.number().optional()
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
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('display_name', username)
      .single<{ id: string }>()

    if (profileError || !profile) {
      logger(
        'ERROR',
        `Failed to fetch profile for username: ${username}`,
        undefined,
        profileError || new Error('No profile returned')
      )
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    const body = (await request.json()) as unknown
    logger(
      'INFO',
      `Playlist API - Incoming request body: ${JSON.stringify(body)}`
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
    const parsed: z.infer<typeof addTrackSchema> = parseWithType(
      addTrackSchema,
      body
    )
    const { tracks, initialVotes } = parsed
    logger(
      'INFO',
      `Playlist API - Parsed tracks data: ${JSON.stringify(tracks)}`
    )

    // Fetch detailed track information from Spotify API to get release date and genre
    let detailedTrackInfo: {
      album?: { release_date?: string }
      artists?: Array<{ genres?: string[] }>
    } | null = null
    try {
      // Get admin profile for Spotify API access
      const { data: adminProfile, error: adminError } = await supabase
        .from('profiles')
        .select(
          'spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
        )
        .ilike('display_name', '3B')
        .single()

      if (!adminError && adminProfile?.spotify_access_token) {
        const response = await fetch(
          `https://api.spotify.com/v1/tracks/${tracks.id}`,
          {
            headers: {
              Authorization: `Bearer ${adminProfile.spotify_access_token}`
            }
          }
        )

        if (response.ok) {
          detailedTrackInfo = (await response.json()) as {
            album?: { release_date?: string }
            artists?: Array<{ genres?: string[] }>
          }
          logger(
            'INFO',
            `Playlist API - Detailed track info: ${JSON.stringify(detailedTrackInfo)}`
          )
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

    const genre = detailedTrackInfo?.artists?.[0]?.genres?.[0] ?? null

    const { data: upsertedTrack, error: upsertError } = await supabase
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
      .single()

    if (upsertError || !upsertedTrack) {
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
        upsertError || new Error('No track returned from upsert')
      )
      return NextResponse.json(
        { error: `Failed to save track with Spotify ID ${tracks.id}` },
        { status: 500 }
      )
    }

    const { error: insertError } = await supabase.from('jukebox_queue').insert({
      profile_id: profile.id,
      track_id: upsertedTrack.id,
      votes: initialVotes ?? 5
    })

    if (insertError) {
      logger(
        'ERROR',
        `Queue insert error details: ${JSON.stringify(insertError)}`
      )
      logger(
        'ERROR',
        'Failed to insert track into jukebox queue',
        undefined,
        insertError
      )
      return NextResponse.json(
        { error: 'Failed to add track to queue' },
        { status: 500 }
      )
    }

    // Log the track suggestion for analytics
    const { error: logError } = await supabase.rpc('log_track_suggestion', {
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
    })

    if (logError) {
      logger(
        'ERROR',
        `Track suggestion logging error: ${JSON.stringify(logError)}`
      )
      logger('ERROR', 'Failed to log track suggestion', undefined, logError)
      // Don't fail the entire request if logging fails, just log the error
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
