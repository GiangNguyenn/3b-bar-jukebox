import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Random Track')

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { username?: string }
    const { username } = body

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      )
    }

    logger('INFO', `Fetching random track for username: ${username}`)

    // Get the profile ID for the username
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', username)
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

    logger('INFO', `Profile found with ID: ${profile.id}`)

    // First, check if there are any tracks in the database
    const { count: trackCount, error: countError } = await supabase
      .from('tracks')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      logger(
        'ERROR',
        'Failed to count tracks in database',
        undefined,
        countError
      )
      return NextResponse.json(
        { error: 'Failed to access tracks database' },
        { status: 500 }
      )
    }

    logger('INFO', `Total tracks in database: ${trackCount}`)

    if (trackCount === 0) {
      logger('WARN', 'No tracks found in database')
      return NextResponse.json(
        { error: 'No tracks available in database' },
        { status: 404 }
      )
    }

    // Get a random track from the database
    // Try different approaches to get a random track

    logger('INFO', 'Attempting to fetch random track from database')

    // First try with RANDOM() function
    let { data: randomTrack, error: trackError } = await supabase
      .from('tracks')
      .select(
        'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url'
      )
      .order('RANDOM()')
      .limit(1)
      .single()

    // If RANDOM() fails, try without it
    if (trackError) {
      logger(
        'WARN',
        'RANDOM() function failed, trying without it',
        undefined,
        trackError
      )

      const { data: fallbackTrack, error: fallbackError } = await supabase
        .from('tracks')
        .select(
          'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url'
        )
        .limit(1)
        .single()

      if (fallbackError) {
        logger(
          'ERROR',
          'Failed to get random track from database (both RANDOM() and fallback failed)',
          undefined,
          fallbackError
        )
        return NextResponse.json(
          { error: 'Failed to get random track' },
          { status: 500 }
        )
      }

      randomTrack = fallbackTrack
      trackError = fallbackError
    }

    if (!randomTrack) {
      logger('WARN', 'No random track found in database')
      return NextResponse.json(
        { error: 'No tracks available in database' },
        { status: 404 }
      )
    }

    logger('INFO', `Random track found: ${JSON.stringify(randomTrack)}`)

    return NextResponse.json({
      success: true,
      track: {
        id: randomTrack.id as string, // Database UUID
        spotify_track_id: randomTrack.spotify_track_id as string, // Actual Spotify track ID
        name: randomTrack.name as string,
        artist: randomTrack.artist as string,
        album: randomTrack.album as string,
        duration_ms: randomTrack.duration_ms as number,
        popularity: randomTrack.popularity as number,
        spotify_url: randomTrack.spotify_url as string
      }
    })
  } catch (error) {
    logger(
      'ERROR',
      'Unexpected error in random track API',
      undefined,
      error instanceof Error ? error : new Error('Unknown error')
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
