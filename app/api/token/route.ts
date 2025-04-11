import { NextResponse } from 'next/server'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

// Configure the route to be dynamic
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? ''
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? ''

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

export async function GET(): Promise<NextResponse<SpotifyTokenResponse | ErrorResponse>> {
  try {
    if (!refreshToken) {
      throw new AppError(ERROR_MESSAGES.UNAUTHORIZED, undefined, 'TokenRefresh')
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
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
        refresh_token: refreshToken
      }),
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>
      console.error('\n[ERROR] Failed to refresh token:', {
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
        'TokenRefresh'
      )
    }

    const data = await response.json() as SpotifyTokenResponse

    return NextResponse.json(data)
  } catch (error) {
    console.error('\n[ERROR] Unexpected error in token refresh:', error)
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
