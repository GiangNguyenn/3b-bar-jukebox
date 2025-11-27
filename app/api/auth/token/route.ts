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
  expires_in: number
}

interface AdminProfile {
  id: string
  display_name: string | null
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

    // Get admin profile from database - try '3B' first, then fallback to first profile
    let adminProfile: AdminProfile | null = null
    let profileError: unknown = null

    // First, try to find profile with '3B' in display_name (admin profile)
    const { data: adminProfile3B, error: error3B } = await supabase
      .from('profiles')
      .select(
        'id, display_name, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .ilike('display_name', '3B')
      .single()

    if (!error3B && adminProfile3B) {
      adminProfile = adminProfile3B as AdminProfile
    } else {
      // Fallback: try to get first profile if '3B' profile not found
      const { data: fallbackProfile, error: fallbackError } = await supabase
        .from('profiles')
        .select(
          'id, display_name, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
        )
        .limit(1)
        .single()

      if (!fallbackError && fallbackProfile) {
        adminProfile = fallbackProfile as AdminProfile
        profileError = null
      } else {
        profileError = fallbackError || error3B
      }
    }

    if (profileError || !adminProfile) {
      logger(
        'ERROR',
        'Error fetching admin profile',
        undefined,
        profileError instanceof Error ? profileError : undefined
      )
      return NextResponse.json(
        {
          error: "Admin profile '3B' not found or database error occurred",
          code: 'ADMIN_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }

    // Type guard to ensure adminProfile has required fields
    const missingFields: string[] = []
    if (!adminProfile.spotify_access_token) {
      missingFields.push('spotify_access_token')
    }
    if (!adminProfile.spotify_refresh_token) {
      missingFields.push('spotify_refresh_token')
    }
    if (adminProfile.spotify_token_expires_at === null) {
      missingFields.push('spotify_token_expires_at')
    }

    if (missingFields.length > 0) {
      const profileInfo = `Profile ID: ${adminProfile.id}, Display Name: ${adminProfile.display_name ?? 'null'}`
      logger(
        'ERROR',
        `Invalid admin profile data - missing fields: ${missingFields.join(', ')}. ${profileInfo}`,
        undefined,
        undefined
      )
      return NextResponse.json(
        {
          error: `Invalid admin profile data: missing required fields (${missingFields.join(', ')}). Profile: ${adminProfile.display_name ?? 'unknown'} (ID: ${adminProfile.id})`,
          code: 'INVALID_PROFILE_DATA',
          status: 500
        },
        { status: 500 }
      )
    }

    // At this point, we've validated all required fields are present
    // Extract non-null values for TypeScript
    const tokenExpiresAt = adminProfile.spotify_token_expires_at
    const accessToken = adminProfile.spotify_access_token
    const refreshToken = adminProfile.spotify_refresh_token

    // Additional runtime check (should never fail due to validation above)
    if (!accessToken || !refreshToken || tokenExpiresAt === null) {
      return NextResponse.json(
        {
          error: 'Invalid admin profile data',
          code: 'INVALID_ADMIN_PROFILE',
          status: 500
        },
        { status: 500 }
      )
    }

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
        refreshToken,
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
          currentRefreshToken: refreshToken
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

      // Calculate expires_in (seconds remaining) - use refreshResult.expiresIn if available
      // If expiresIn is undefined, use a safe default (3600 seconds = 1 hour)
      // Don't use tokenExpiresAt as fallback since it's already expired
      const expiresIn = refreshResult.expiresIn ?? 3600 // Default to 1 hour if expiresIn is not provided

      return NextResponse.json({
        access_token: refreshResult.accessToken,
        refresh_token: refreshResult.refreshToken ?? refreshToken,
        expires_in: expiresIn
      })
    }

    // Token is still valid, calculate expires_in (seconds remaining)
    const expiresIn = Math.max(
      0,
      tokenExpiresAt - Math.floor(Date.now() / 1000)
    )

    return NextResponse.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn
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
