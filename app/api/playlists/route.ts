import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Get the current user
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get the provider token from the session
    const providerToken = session.provider_token
    if (!providerToken) {
      console.error('No provider token found in session')
      return NextResponse.json(
        { error: 'No access token available' },
        { status: 401 }
      )
    }

    // Get the user from the session
    const user = session.user
    console.log('User data:', {
      id: user.id,
      metadata: user.user_metadata,
      email: user.email
    })

    // Get user's profile to get Spotify user ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('spotify_user_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('Error fetching profile:', profileError)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    console.log('Profile data:', profile)

    // Check if user already has a playlist
    const { data: existingPlaylist } = await supabase
      .from('playlists')
      .select()
      .eq('user_id', user.id)
      .single()

    if (existingPlaylist) {
      console.log('Existing playlist found:', existingPlaylist)
      return NextResponse.json({
        message: 'Playlist already exists',
        playlist: existingPlaylist
      })
    }

    console.log('Creating Spotify playlist for user:', profile.spotify_user_id)

    // Create new playlist in Spotify
    const response = await fetch(
      `https://api.spotify.com/v1/users/${profile.spotify_user_id}/playlists`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${providerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: '3B Saigon',
          description: 'My 3B Saigon playlist',
          public: true
        })
      }
    )

    if (!response.ok) {
      const error = await response.json()
      console.error('Spotify API error:', {
        status: response.status,
        statusText: response.statusText,
        error
      })
      return NextResponse.json(
        {
          error: 'Failed to create Spotify playlist',
          details: error
        },
        { status: 500 }
      )
    }

    const spotifyPlaylist = await response.json()
    console.log('Spotify playlist created:', spotifyPlaylist)

    // Store playlist in database
    const { data: playlist, error: insertError } = await supabase
      .from('playlists')
      .insert({
        user_id: user.id,
        spotify_playlist_id: spotifyPlaylist.id,
        name: spotifyPlaylist.name
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error storing playlist:', insertError)
      return NextResponse.json(
        { error: 'Failed to store playlist' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Playlist created successfully',
      playlist
    })
  } catch (error) {
    console.error('Error in playlist creation:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Get the current user
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get user's playlists
    const { data: playlists, error: playlistsError } = await supabase
      .from('playlists')
      .select()
      .eq('user_id', session.user.id)

    if (playlistsError) {
      console.error('Error fetching playlists:', playlistsError)
      return NextResponse.json(
        { error: 'Failed to fetch playlists' },
        { status: 500 }
      )
    }

    return NextResponse.json({ playlists })
  } catch (error) {
    console.error('Error in playlist fetch:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
