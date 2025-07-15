import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import {
  SpotifyTokenResponse,
  SpotifyPlaybackState
} from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

// Set up logger for this module
const logger = createModuleLogger('NowPlaying')

// Types
interface UserProfile {
  id: string
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

// Environment variables
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  throw new Error(
    'Missing required environment variables: SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET'
  )
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(): Promise<
  NextResponse<SpotifyPlaybackState | null | ErrorResponse>
> {
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

    // Get admin profile from database - use '3B' as the default admin username
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .ilike('display_name', '3B')
      .single()

    if (profileError || !userProfile) {
      logger(
        'ERROR',
        `Error fetching admin profile: ${JSON.stringify(profileError)}`
      )
      return NextResponse.json(
        {
          error: 'Failed to get admin credentials',
          code: 'ADMIN_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }

    const typedProfile = userProfile as UserProfile

    // Check if token needs refresh
    const tokenExpiresAt = typedProfile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)
    let accessToken = typedProfile.spotify_access_token

    if (tokenExpiresAt && tokenExpiresAt <= now) {
      // Token is expired, refresh it
      if (!typedProfile.spotify_refresh_token) {
        logger('ERROR', 'No refresh token available')
        return NextResponse.json(
          {
            error: 'No refresh token available',
            code: 'NO_REFRESH_TOKEN',
            status: 500
          },
          { status: 500 }
        )
      }

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: typedProfile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        logger('ERROR', `Error refreshing token: ${await response.text()}`)
        return NextResponse.json(
          {
            error: 'Failed to refresh token',
            code: 'TOKEN_REFRESH_ERROR',
            status: 500
          },
          { status: 500 }
        )
      }

      const tokenData = (await response.json()) as SpotifyTokenResponse
      accessToken = tokenData.access_token

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: tokenData.access_token,
          spotify_token_expires_at:
            Math.floor(Date.now() / 1000) + tokenData.expires_in
        })
        .eq('id', userProfile.id)

      if (updateError) {
        logger(
          'ERROR',
          `Failed to update now playing: ${JSON.stringify(updateError)}`,
          undefined,
          updateError instanceof Error ? updateError : undefined
        )
        // Log error but continue
      }
    }

    if (!accessToken) {
      logger('ERROR', 'No access token available')
      return NextResponse.json(
        {
          error: 'No access token available',
          code: 'NO_ACCESS_TOKEN',
          status: 500
        },
        { status: 500 }
      )
    }

    // Get currently playing track from Spotify API
    const queryParams = new URLSearchParams({
      market: 'from_token',
      additional_types: 'track,episode'
    })

    const nowPlayingResponse = await fetch(
      `https://api.spotify.com/v1/me/player/currently-playing?${queryParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    if (!nowPlayingResponse.ok) {
      if (nowPlayingResponse.status === 204) {
        // No currently playing track
        return NextResponse.json(null)
      }

      logger('ERROR', `Spotify API error: ${await nowPlayingResponse.text()}`)
      return NextResponse.json(
        {
          error: 'Failed to get currently playing track',
          code: 'SPOTIFY_API_ERROR',
          status: nowPlayingResponse.status
        },
        { status: nowPlayingResponse.status }
      )
    }

    const playbackData =
      (await nowPlayingResponse.json()) as SpotifyPlaybackState
    return NextResponse.json(playbackData)
  } catch (error) {
    logger(
      'ERROR',
      'Error in now-playing route:',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
