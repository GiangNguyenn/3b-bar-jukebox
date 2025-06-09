import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { headers } from 'next/headers'

// Configure the route to be dynamic
export const dynamic = 'force-dynamic'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? ''

interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

interface ErrorResponse {
  error: string
  details?: unknown
}

// Add token cache
const tokenCache: { token: string | null; expiry: number } = {
  token: null,
  expiry: 0
}

export async function GET(
  request: Request
): Promise<NextResponse<SpotifyTokenResponse | ErrorResponse>> {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('[Token] Missing client credentials')
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    // Get the user's session
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session }
    } = await supabase.auth.getSession()

    // Get the display name from the referer URL
    const referer = headers().get('referer')
    if (!referer) {
      console.error('[Token] No referer header found')
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    const refererUrl = new URL(referer)
    const displayName = refererUrl.pathname.split('/')[1]

    if (!displayName) {
      console.error('[Token] No display name found in URL')
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    // Get the user's profile with tokens
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .eq('display_name', displayName)
      .single()

    if (profileError || !profile) {
      console.error('[Token] Failed to get profile:', profileError)
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    // Check if we have a valid cached token
    const now = Date.now()
    const timeUntilExpiry = tokenCache.expiry - now
    const minutesUntilExpiry = timeUntilExpiry / (60 * 1000)

    // If token is valid and not expiring soon (more than 15 minutes left), return cached token
    if (tokenCache.token && minutesUntilExpiry > 15) {
      console.log('[Token] Using cached token')
      return NextResponse.json({
        access_token: tokenCache.token,
        token_type: 'Bearer',
        scope:
          'user-read-playback-state user-modify-playback-state playlist-read-private playlist-modify-private',
        expires_in: Math.floor(timeUntilExpiry / 1000)
      })
    }

    // If the current token is still valid, use it
    if (profile.spotify_access_token && profile.spotify_token_expires_at) {
      const tokenExpiry = new Date(profile.spotify_token_expires_at).getTime()
      if (now < tokenExpiry - 15 * 60 * 1000) {
        // 15 minutes before expiry
        console.log('[Token] Using profile token')
        tokenCache.token = profile.spotify_access_token
        tokenCache.expiry = tokenExpiry
        return NextResponse.json({
          access_token: profile.spotify_access_token,
          token_type: 'Bearer',
          scope:
            'user-read-playback-state user-modify-playback-state playlist-read-private playlist-modify-private',
          expires_in: Math.floor((tokenExpiry - now) / 1000)
        })
      }
    }

    // If we need to refresh the token
    if (!profile.spotify_refresh_token) {
      console.error('[Token] No refresh token available')
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: profile.spotify_refresh_token
      }),
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('[Token] Failed to refresh token:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      })
      throw new AppError(
        errorData.error || 'Failed to refresh Spotify token',
        undefined,
        'TokenRefresh'
      )
    }

    const data = await response.json()
    if (!data.access_token) {
      console.error('[Token] Invalid token response:', data)
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    // Update the profile with new tokens
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        spotify_access_token: data.access_token,
        spotify_refresh_token:
          data.refresh_token || profile.spotify_refresh_token,
        spotify_token_expires_at: new Date(
          now + data.expires_in * 1000
        ).toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('display_name', displayName)

    if (updateError) {
      console.error('[Token] Failed to update profile:', updateError)
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    // Update token cache
    tokenCache.token = data.access_token
    tokenCache.expiry = now + data.expires_in * 1000

    return NextResponse.json({
      access_token: data.access_token,
      token_type: 'Bearer',
      scope:
        'user-read-playback-state user-modify-playback-state playlist-read-private playlist-modify-private',
      expires_in: data.expires_in
    })
  } catch (error) {
    console.error('[Token] Unexpected error in token refresh:', error)
    const appError =
      error instanceof AppError
        ? error
        : new AppError(ERROR_MESSAGES.GENERIC_ERROR, error, 'TokenRefresh')

    return NextResponse.json(
      {
        error: appError.message,
        details: appError.originalError
      },
      { status: 500 }
    )
  }
}
