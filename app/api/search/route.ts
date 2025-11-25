import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { queryWithRetry } from '@/lib/supabaseQuery'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

// Set up logger for this module
const logger = createModuleLogger('Search')

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

interface SearchResponse {
  tracks?: {
    items: Array<{
      id: string
      name: string
      artists: Array<{
        id: string
        name: string
      }>
      album: {
        id: string
        name: string
        images: Array<{
          url: string
          height: number
          width: number
        }>
      }
    }>
  }
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

export async function GET(
  request: Request
): Promise<NextResponse<SearchResponse | ErrorResponse>> {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const type = searchParams.get('type') ?? 'track'
  const username = searchParams.get('username')

  if (!query) {
    return NextResponse.json(
      {
        error: 'Query parameter is required',
        code: 'MISSING_QUERY',
        status: 400
      },
      { status: 400 }
    )
  }

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

    // Get user profile from database - use provided username or fall back to admin
    const displayName = username ?? '3B'
    const profileResult = await queryWithRetry<{
      id: string
      spotify_access_token: string | null
      spotify_refresh_token: string | null
      spotify_token_expires_at: number | null
    }>(
      supabase
        .from('profiles')
        .select(
          'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
        )
        .ilike('display_name', displayName)
        .single(),
      undefined,
      `Fetch user profile for ${displayName}`
    )

    const userProfile = profileResult.data
    const profileError = profileResult.error

    if (profileError || !userProfile) {
      logger(
        'ERROR',
        `Error fetching user profile for ${displayName}: ${JSON.stringify(profileError)}`
      )
      return NextResponse.json(
        {
          error: 'Failed to get user credentials',
          code: 'USER_PROFILE_ERROR',
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

      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        logger('ERROR', 'Missing Spotify client credentials')
        return NextResponse.json(
          {
            error: 'Server configuration error',
            code: 'INVALID_CLIENT_CREDENTIALS',
            status: 500
          },
          { status: 500 }
        )
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

        return NextResponse.json(
          {
            error: errorMessage,
            code: errorCode,
            status: refreshResult.error?.isRecoverable ? 503 : 500
          },
          { status: refreshResult.error?.isRecoverable ? 503 : 500 }
        )
      }

      accessToken = refreshResult.accessToken

      // Update the token in the database with retry logic
      // This is critical - if database update fails, we should not use the token
      const updateResult = await updateTokenInDatabase(
        supabase,
        userProfile.id,
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
        return NextResponse.json(
          {
            error: errorMessage,
            code: errorCode,
            status: updateResult.error?.isRecoverable ? 503 : 500
          },
          { status: updateResult.error?.isRecoverable ? 503 : 500 }
        )
      }
    }

    // Make the search request to Spotify API with market filtering
    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=${type}&limit=10&market=from_token`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    if (!searchResponse.ok) {
      logger('ERROR', `Spotify API error: ${await searchResponse.text()}`)
      return NextResponse.json(
        {
          error: 'Failed to search Spotify',
          code: 'SPOTIFY_API_ERROR',
          status: searchResponse.status
        },
        { status: searchResponse.status }
      )
    }

    const searchData = (await searchResponse.json()) as SearchResponse
    return NextResponse.json(searchData)
  } catch (error) {
    logger(
      'ERROR',
      'Error in search route:',
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
