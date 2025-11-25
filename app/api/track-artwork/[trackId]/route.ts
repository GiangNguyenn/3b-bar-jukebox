import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

const logger = createModuleLogger('API Track Artwork')

// Add caching - artwork URLs rarely change, cache for 24 hours
export const revalidate = 86400 // 24 hours in seconds

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

export async function GET(
  request: Request,
  { params }: { params: { trackId: string } }
): Promise<NextResponse<{ artworkUrl: string | null } | ErrorResponse>> {
  try {
    const { trackId } = params

    if (!trackId) {
      logger('ERROR', 'Track artwork API: No track ID provided')
      return NextResponse.json(
        {
          error: 'Track ID is required',
          code: 'MISSING_TRACK_ID',
          status: 400
        },
        { status: 400 }
      )
    }

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
        `Track artwork API: Error fetching admin profile: ${JSON.stringify(profileError)}`
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
        logger('ERROR', 'Track artwork API: No refresh token available')
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

        logger(
          'ERROR',
          `Track artwork API: Token refresh failed: ${errorCode} - ${errorMessage}`
        )

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
          `Track artwork API: Token refresh succeeded but database update failed: ${errorCode} - ${errorMessage}`
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

    if (!accessToken) {
      logger('ERROR', 'Track artwork API: No access token available')
      return NextResponse.json(
        {
          error: 'No access token available',
          code: 'NO_ACCESS_TOKEN',
          status: 500
        },
        { status: 500 }
      )
    }

    logger(
      'INFO',
      'Track artwork API: Got access token, fetching from Spotify API'
    )

    // Fetch track details from Spotify API
    const spotifyResponse = await fetch(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    logger(
      'INFO',
      `Track artwork API: Spotify API response status: ${spotifyResponse.status}`
    )

    if (!spotifyResponse.ok) {
      const errorText = await spotifyResponse.text()
      logger(
        'ERROR',
        `Track artwork API: Spotify API error: ${JSON.stringify({
          status: spotifyResponse.status,
          statusText: spotifyResponse.statusText,
          errorText
        })}`
      )
      return NextResponse.json(
        {
          error: `Failed to fetch track from Spotify: ${spotifyResponse.status} ${spotifyResponse.statusText}`,
          code: 'SPOTIFY_API_ERROR',
          status: spotifyResponse.status
        },
        { status: spotifyResponse.status }
      )
    }

    const trackData = (await spotifyResponse.json()) as {
      id: string
      name: string
      album?: {
        name: string
        images?: Array<{ url: string }>
      }
    }
    logger(
      'INFO',
      `Track artwork API: Track data received: ${JSON.stringify({
        id: trackData.id,
        name: trackData.name,
        album: trackData.album?.name,
        images: trackData.album?.images?.length ?? 0
      })}`
    )

    const artworkUrl = trackData.album?.images?.[0]?.url ?? null

    // Add caching headers - artwork URLs rarely change
    const response = NextResponse.json({ artworkUrl })
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=86400, stale-while-revalidate=172800'
    )
    return response
  } catch (error) {
    logger(
      'ERROR',
      `Track artwork API: Unexpected error: ${JSON.stringify(error)}`
    )
    return NextResponse.json(
      {
        error: 'Failed to fetch track artwork',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
