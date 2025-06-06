import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'

interface SpotifyPlaylistResponse {
  id: string
  name: string
  description: string
  public: boolean
  owner: {
    id: string
    display_name: string
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile to get their ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile) {
      console.error('[Create Playlist] Error fetching profile:', profileError)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check if user already has a playlist
    const { data: existingPlaylist, error: playlistError } = await supabase
      .from('playlists')
      .select('spotify_playlist_id')
      .eq('user_id', profile.id)
      .single()

    if (playlistError && playlistError.code !== 'PGRST116') {
      // PGRST116 is "no rows returned"
      console.error(
        '[Create Playlist] Error checking existing playlist:',
        playlistError
      )
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (existingPlaylist) {
      return NextResponse.json(
        { error: 'Playlist already exists' },
        { status: 400 }
      )
    }

    // Create playlist in Spotify
    const response = await sendApiRequest<SpotifyPlaylistResponse>({
      path: '/me/playlists',
      method: 'POST',
      body: {
        name: '3B Saigon',
        description: 'A boutique beer & music experience',
        public: true
      }
    })

    if (!response.id) {
      console.error(
        '[Create Playlist] Error creating Spotify playlist:',
        response
      )
      return NextResponse.json(
        { error: 'Failed to create Spotify playlist' },
        { status: 500 }
      )
    }

    // Store playlist ID in database
    const { error: insertError } = await supabase.from('playlists').insert({
      user_id: profile.id,
      spotify_playlist_id: response.id
    })

    if (insertError) {
      console.error('[Create Playlist] Error storing playlist ID:', insertError)
      return NextResponse.json(
        { error: 'Failed to store playlist ID' },
        { status: 500 }
      )
    }

    return NextResponse.json({ playlistId: response.id })
  } catch (error) {
    console.error('[Create Playlist] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
