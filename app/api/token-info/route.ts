import { NextResponse } from 'next/server'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { TokenResponse } from '@/shared/utils/token'

// Configure the route to be dynamic
export const dynamic = 'force-dynamic'

// Constants for token endpoint
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN

interface ErrorResponse {
  error: string
  details?: unknown
}

// Add token cache
const tokenCache: { token: string | null; expiry: number } = {
  token: null,
  expiry: 0
}

export async function GET(): Promise<
  NextResponse<TokenResponse | ErrorResponse>
> {
  try {
    if (!refreshToken) {
      console.error('[Token] Missing refresh token')
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'Token')
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('[Token] Missing client credentials')
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'Token')
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

    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      console.error('[Token] Failed to refresh token:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        headers: Object.fromEntries(response.headers.entries())
      })

      throw new AppError(
        ERROR_MESSAGES.UNAUTHORIZED,
        {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        },
        'Token'
      )
    }

    const data = (await response.json()) as TokenResponse
    console.log('[Token] Successfully refreshed token')

    // Update token cache
    tokenCache.token = data.access_token
    tokenCache.expiry = now + data.expires_in * 1000

    return NextResponse.json(data)
  } catch (error) {
    console.error('[Token] Unexpected error in token refresh:', error)
    const appError =
      error instanceof AppError
        ? error
        : new AppError(ERROR_MESSAGES.GENERIC_ERROR, error, 'Token')

    return NextResponse.json(
      {
        error: appError.message,
        details: appError.originalError
      },
      { status: 500 }
    )
  }
}
