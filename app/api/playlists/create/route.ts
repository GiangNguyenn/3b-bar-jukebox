import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

interface CreatePlaylistResponse {
  id: string
  name: string
  description: string | null
  public: boolean
  owner: {
    id: string
    display_name: string
  }
  tracks: {
    href: string
    total: number
  }
  type: string
  uri: string
}

export async function POST(): Promise<NextResponse> {
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

    // Check if user already has a playlist
    const { data: existingPlaylist, error: playlistError } = await supabase
      .from('playlists')
      .select('spotify_playlist_id')
      .eq('user_id', user.id)
      .single()

    if (playlistError && playlistError.code !== 'PGRST116') {
      console.error('Error checking existing playlist:', playlistError)
      return NextResponse.json(
        { error: 'Failed to check existing playlist' },
        { status: 500 }
      )
    }

    if (existingPlaylist) {
      console.log('Playlist already exists:', existingPlaylist)
      return NextResponse.json({ message: 'Playlist already exists' })
    }

    // Create playlist in Spotify
    const response = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.user_metadata.access_token}`
      },
      body: JSON.stringify({
        name: `${user.user_metadata.name}'s Playlist`,
        description: 'Created by JM Bar Jukebox',
        public: false
      })
    })

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

    const playlistData = (await response.json()) as CreatePlaylistResponse

    // Store playlist in database
    const { error: insertError } = await supabase.from('playlists').insert({
      user_id: user.id,
      spotify_playlist_id: playlistData.id
    })

    if (insertError) {
      console.error('Error creating playlist:', insertError)
      return NextResponse.json(
        {
          error: 'Failed to create playlist',
          details: insertError
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: 'Playlist created successfully' })
  } catch (error) {
    console.error('Error in playlist creation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
