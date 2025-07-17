import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', username)
      .single<{ id: string }>()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    // Get available tracks after exclusion
    const tracksQuery = supabase
      .from('tracks')
      .select(
        'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url'
      )
      .limit(50) // Get up to 50 tracks to pick from

    const { data: allTracks, error: tracksError } = await tracksQuery

    if (tracksError) {
      return NextResponse.json(
        { error: 'Failed to get tracks from database' },
        { status: 500 }
      )
    }

    if (!allTracks || allTracks.length === 0) {
      return NextResponse.json(
        { error: 'No tracks available in database' },
        { status: 404 }
      )
    }

    // Filter out excluded tracks
    let availableTracks = allTracks
    if (excludedTrackIds && excludedTrackIds.length > 0) {
      availableTracks = allTracks.filter(
        (track: { spotify_track_id: string }) =>
          !excludedTrackIds.includes(track.spotify_track_id)
      )
    }

    if (availableTracks.length === 0) {
      return NextResponse.json(
        { error: 'No tracks available in database after exclusion' },
        { status: 404 }
      )
    }

    // Pick a random track from the available tracks
    const randomTrack =
      availableTracks[Math.floor(Math.random() * availableTracks.length)]
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
