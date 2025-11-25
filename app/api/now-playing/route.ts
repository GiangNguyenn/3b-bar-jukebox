import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

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

// Use revalidate for caching - 8 seconds matches our polling interval
// Removed 'force-dynamic' to allow caching to work properly
export const revalidate = 8

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
      const errorResponse = NextResponse.json(
        {
          error: 'Failed to get admin credentials',
          code: 'ADMIN_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
      // Prevent caching of error responses
      errorResponse.headers.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      )
      return errorResponse
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
        const errorResponse = NextResponse.json(
          {
            error: 'No refresh token available',
            code: 'NO_REFRESH_TOKEN',
            status: 500
          },
          { status: 500 }
        )
        errorResponse.headers.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate'
        )
        return errorResponse
      }

      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        logger('ERROR', 'Missing Spotify client credentials')
        const errorResponse = NextResponse.json(
          {
            error: 'Server configuration error',
            code: 'INVALID_CLIENT_CREDENTIALS',
            status: 500
          },
          { status: 500 }
        )
        errorResponse.headers.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate'
        )
        return errorResponse
      }

      // Use recovery module for token refresh with retry logic
      const refreshResult = await refreshTokenWithRetry(
        typedProfile.spotify_refresh_token,
        SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET
      )

      if (!refreshResult.success || !refreshResult.accessToken) {
        const errorCode = refreshResult.error?.code ?? 'TOKEN_REFRESH_ERROR'
        const errorMessage =
          refreshResult.error?.message ?? 'Failed to refresh token'

        logger('ERROR', `Token refresh failed: ${errorCode} - ${errorMessage}`)

        const errorResponse = NextResponse.json(
          {
            error: errorMessage,
            code: errorCode,
            status: refreshResult.error?.isRecoverable ? 503 : 500
          },
          { status: refreshResult.error?.isRecoverable ? 503 : 500 }
        )
        errorResponse.headers.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate'
        )
        return errorResponse
      }

      accessToken = refreshResult.accessToken

      // Update the token in the database with retry logic
      // This is critical - if database update fails, we should not use the token
      const updateResult = await updateTokenInDatabase(
        supabase,
        String(userProfile.id),
        {
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken,
          expiresIn: refreshResult.expiresIn,
          currentRefreshToken: typedProfile.spotify_refresh_token
        }
      )

      if (!updateResult.success) {
        const errorCode = updateResult.error?.code ?? 'DATABASE_UPDATE_ERROR'
        const errorMessage =
          updateResult.error?.message ?? 'Failed to update token in database'

        logger(
          'ERROR',
          `Token refresh succeeded but database update failed: ${errorCode} - ${errorMessage}`
        )

        // Return error - don't proceed with request if we can't persist token
        const errorResponse = NextResponse.json(
          {
            error: errorMessage,
            code: errorCode,
            status: updateResult.error?.isRecoverable ? 503 : 500
          },
          { status: updateResult.error?.isRecoverable ? 503 : 500 }
        )
        errorResponse.headers.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate'
        )
        return errorResponse
      }
    }

    if (!accessToken) {
      logger('ERROR', 'No access token available')
      const errorResponse = NextResponse.json(
        {
          error: 'No access token available',
          code: 'NO_ACCESS_TOKEN',
          status: 500
        },
        { status: 500 }
      )
      errorResponse.headers.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      )
      return errorResponse
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

    // Handle 204 No Content (no currently playing track)
    // 204 is a success status (2xx), so nowPlayingResponse.ok is true
    if (nowPlayingResponse.status === 204) {
      const response = NextResponse.json(null)
      // Add caching headers even for null responses to reduce API calls when not playing
      response.headers.set(
        'Cache-Control',
        'public, s-maxage=8, stale-while-revalidate=16'
      )
      return response
    }

    // Read response body once and reuse for both error logging and JSON parsing
    // Response bodies can only be read once, so we must store the text
    const responseText = await nowPlayingResponse.text()

    if (!nowPlayingResponse.ok) {
      logger('ERROR', `Spotify API error: ${responseText}`)
      const errorResponse = NextResponse.json(
        {
          error: 'Failed to get currently playing track',
          code: 'SPOTIFY_API_ERROR',
          status: nowPlayingResponse.status
        },
        { status: nowPlayingResponse.status }
      )
      errorResponse.headers.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      )
      return errorResponse
    }

    // Check if response has content before parsing JSON
    if (!responseText.trim()) {
      // Empty body (shouldn't happen if status is 200, but handle it)
      const response = NextResponse.json(null)
      // Add caching headers even for null responses to reduce API calls
      response.headers.set(
        'Cache-Control',
        'public, s-maxage=8, stale-while-revalidate=16'
      )
      return response
    }

    const playbackData = JSON.parse(responseText) as SpotifyPlaybackState

    // Add caching headers to reduce API calls
    const response = NextResponse.json(playbackData)
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=8, stale-while-revalidate=16'
    )
    return response
  } catch (error) {
    logger(
      'ERROR',
      'Error in now-playing route:',
      undefined,
      error instanceof Error ? error : undefined
    )
    const errorResponse = NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
    errorResponse.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    )
    return errorResponse
  }
}
