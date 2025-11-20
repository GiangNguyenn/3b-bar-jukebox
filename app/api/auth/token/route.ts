import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import {
  refreshTokenWithRetry,
  isNetworkErrorRecoverable
} from '@/recovery/tokenRecovery'

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
      console.error('[AuthToken] Error fetching admin profile:', profileError)
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
        console.error('[AuthToken] Missing Spotify client credentials')
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

        console.error(
          `[AuthToken] Token refresh failed: ${errorCode} - ${errorMessage}`
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

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: refreshResult.accessToken,
          spotify_refresh_token:
            refreshResult.refreshToken ?? typedProfile.spotify_refresh_token,
          spotify_token_expires_at: refreshResult.expiresIn
            ? Math.floor(Date.now() / 1000) + refreshResult.expiresIn
            : null
        })
        .eq('id', adminProfile.id)

      if (updateError) {
        console.error('[AuthToken] Error updating token:', updateError)
      }

      return NextResponse.json({
        access_token: refreshResult.accessToken,
        refresh_token:
          refreshResult.refreshToken ?? typedProfile.spotify_refresh_token,
        expires_at: refreshResult.expiresIn
          ? Math.floor(Date.now() / 1000) + refreshResult.expiresIn
          : tokenExpiresAt
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
      console.warn(
        '[AuthToken] Network error (potentially recoverable):',
        error
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

    console.error('[AuthToken] Error:', error)
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
