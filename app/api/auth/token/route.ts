import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  refreshTokenWithRetry,
  isNetworkErrorRecoverable
} from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

const logger = createModuleLogger('AuthToken')

// Types
interface ErrorResponse {
  error: string
  code: string
  status: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface AdminProfile {
  id: string
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
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
  NextResponse<TokenResponse | ErrorResponse>
> {
  try {
    const cookieStore = cookies()

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            const allCookies = cookieStore.getAll()
            return allCookies.filter((cookie) => cookie.name.startsWith('sb-'))
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

    // Get admin profile from database
    const { data: adminProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .limit(1)
      .single()

    if (profileError || !adminProfile) {
      logger(
        'ERROR',
        'Error fetching admin profile',
        undefined,
        profileError instanceof Error ? profileError : undefined
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

    // Type guard to ensure adminProfile has required fields
    const typedProfile = adminProfile as AdminProfile
    if (
      !typedProfile.spotify_access_token ||
      !typedProfile.spotify_refresh_token ||
      typedProfile.spotify_token_expires_at === null
    ) {
      return NextResponse.json(
        {
          error: 'Invalid admin profile data',
          code: 'INVALID_PROFILE_DATA',
          status: 500
        },
        { status: 500 }
      )
    }

    // Check if token needs refresh
    const tokenExpiresAt = typedProfile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)

    if (tokenExpiresAt <= now) {
      // Token is expired, refresh it
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

      // Update the token in the database with retry logic
      // This is critical - if database update fails, we should not return the token
      const updateResult = await updateTokenInDatabase(
        supabase,
        String(adminProfile.id),
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

        // Return error - don't return token if we can't persist it
        return NextResponse.json(
          {
            error: errorMessage,
            code: errorCode,
            status: updateResult.error?.isRecoverable ? 503 : 500
          },
          { status: updateResult.error?.isRecoverable ? 503 : 500 }
        )
      }

      // Calculate expires_at - use refreshResult.expiresIn if available
      // If expiresIn is undefined, use a safe default (3600 seconds = 1 hour)
      // Don't use tokenExpiresAt as fallback since it's already expired
      const expiresAt =
        refreshResult.expiresIn !== undefined
          ? Math.floor(Date.now() / 1000) + refreshResult.expiresIn
          : Math.floor(Date.now() / 1000) + 3600 // Default to 1 hour if expiresIn is not provided

      return NextResponse.json({
        access_token: refreshResult.accessToken,
        refresh_token:
          refreshResult.refreshToken ?? typedProfile.spotify_refresh_token,
        expires_at: expiresAt
      })
    }

    // Token is still valid, return it
    return NextResponse.json({
      access_token: typedProfile.spotify_access_token,
      refresh_token: typedProfile.spotify_refresh_token,
      expires_at: tokenExpiresAt
    })
  } catch (error) {
    // Check if it's a network error that might be recoverable
    if (isNetworkErrorRecoverable(error)) {
      logger(
        'WARN',
        'Network error (potentially recoverable)',
        undefined,
        error instanceof Error ? error : undefined
      )
      return NextResponse.json(
        {
          error: 'Network error. Please try again.',
          code: 'NETWORK_ERROR',
          status: 503
        },
        { status: 503 }
      )
    }

    logger(
      'ERROR',
      'Error in auth token endpoint',
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
