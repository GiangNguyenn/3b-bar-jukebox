import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import type { SpotifyPlaylistItem } from '@/shared/types'

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createRouteHandlerClient<Database>({ cookies })

    // Get the current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('Auth error:', userError)
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get the user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Error fetching profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 }
      )
    }

    if (!profile) {
      console.error('Profile not found')
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Get the user's playlist
    const { data: playlist, error: playlistError } = await supabase
      .from('playlists')
      .select('spotify_playlist_id')
      .eq('user_id', user.id)
      .single()

    if (playlistError) {
      console.error('Error fetching playlist:', playlistError)
      return NextResponse.json(
        { error: 'Failed to fetch playlist' },
        { status: 500 }
      )
    }

    if (!playlist) {
      console.error('Playlist not found')
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 })
    }

    // Get the playlist details from Spotify
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlist.spotify_playlist_id}`,
      {
        headers: {
          Authorization: `Bearer ${user.user_metadata.access_token}`
        }
      }
    )

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error: { message: string }
      }
      console.error('Spotify API error:', errorData)
      return NextResponse.json(
        { error: errorData.error.message },
        { status: response.status }
      )
    }

    const playlistData = (await response.json()) as SpotifyPlaylistItem

    return NextResponse.json({ playlist: playlistData })
  } catch (error) {
    console.error('Error in playlist route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = createRouteHandlerClient<Database>({ cookies })

    // Get the current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('Auth error:', userError)
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get the user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Error fetching profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 }
      )
    }

    if (!profile) {
      console.error('Profile not found')
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Get the user's playlist
    const { data: playlist, error: playlistError } = await supabase
      .from('playlists')
      .select('spotify_playlist_id')
      .eq('user_id', user.id)
      .single()

    if (playlistError) {
      console.error('Error fetching playlist:', playlistError)
      return NextResponse.json(
        { error: 'Failed to fetch playlist' },
        { status: 500 }
      )
    }

    if (!playlist) {
      console.error('Playlist not found')
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 })
    }

    // Get the request body
    const body = (await request.json()) as { trackUri: string }

    if (!body.trackUri) {
      return NextResponse.json(
        { error: 'Track URI is required' },
        { status: 400 }
      )
    }

    // Add the track to the playlist
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlist.spotify_playlist_id}/tracks`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.user_metadata.access_token}`
        },
        body: JSON.stringify({
          uris: [body.trackUri]
        })
      }
    )

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error: { message: string }
      }
      console.error('Spotify API error:', errorData)
      return NextResponse.json(
        { error: errorData.error.message },
        { status: response.status }
      )
    }

    const responseData = (await response.json()) as { snapshot_id: string }

    return NextResponse.json({ snapshot_id: responseData.snapshot_id })
  } catch (error) {
    console.error('Error in playlist route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
