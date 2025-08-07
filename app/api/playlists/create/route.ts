import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

// Set up logger for this module
const logger = createModuleLogger('PlaylistCreate')

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
    const cookieStore = cookies()

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          }
        }
      }
    )

    // Get the current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      logger('ERROR', `Auth error: ${JSON.stringify(userError)}`)
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get the user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      logger('ERROR', `Error fetching profile: ${JSON.stringify(profileError)}`)
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 }
      )
    }

    if (!profile) {
      logger('ERROR', 'Profile not found')
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check if user already has a playlist
    const { data: existingPlaylist, error: playlistError } = await supabase
      .from('playlists')
      .select('spotify_playlist_id')
      .eq('user_id', user.id)
      .single()

    if (playlistError && playlistError.code !== 'PGRST116') {
      logger(
        'ERROR',
        `Error checking existing playlist: ${JSON.stringify(playlistError)}`
      )
      return NextResponse.json(
        { error: 'Failed to check existing playlist' },
        { status: 500 }
      )
    }

    if (existingPlaylist) {
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
        description: 'Created by 3B Jukebox',
        public: false
      })
    })

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error: { message: string }
      }
      logger('ERROR', `Spotify API error: ${JSON.stringify(errorData)}`)
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
      logger('ERROR', `Error creating playlist: ${JSON.stringify(insertError)}`)
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
    logger(
      'ERROR',
      'Error in playlist creation:',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
