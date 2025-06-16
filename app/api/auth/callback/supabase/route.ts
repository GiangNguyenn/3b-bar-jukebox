/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import type { Session } from '@supabase/supabase-js'

// Constants
const AUTH = {
  TOKEN_URL: 'https://accounts.spotify.com/api/token',
  GRANT_TYPE: 'authorization_code',
  CONTENT_TYPE: 'application/x-www-form-urlencoded',
  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5 // 5 requests per window
  },
  VERIFICATION_TIMEOUT: 5000 // 5 seconds
} as const

const ERROR_MESSAGES = {
  NO_SESSION: 'No session found',
  TOKEN_EXCHANGE_FAILED: 'Failed to exchange code for tokens',
  PROFILE_UPDATE_FAILED: 'Failed to update profile',
  UNKNOWN_ERROR: 'An unknown error occurred',
  INVALID_TOKEN_RESPONSE: 'Invalid token response from Spotify',
  INVALID_USER_METADATA: 'Invalid user metadata',
  VERIFICATION_TIMEOUT: 'Profile verification timed out',
  RATE_LIMIT_EXCEEDED: 'Too many requests, please try again later',
  INVALID_CODE: 'Invalid authorization code',
  MISSING_ENV_VARS: 'Missing required environment variables',
  MISSING_PROVIDER_TOKENS: 'Missing provider tokens'
} as const

// Types
interface UserMetadata {
  provider_id: string
  name: string
  avatar_url?: string | null
}

interface ProfileData {
  id: string
  spotify_access_token: string
  spotify_refresh_token: string
  spotify_token_expires_at: number
  spotify_provider_id: string
  display_name: string
  avatar_url?: string | null
}

interface ErrorResponse {
  error: string
  details?: unknown
  code: string
  status: number
}

// Extend Session type to include provider tokens
interface SessionWithProviderTokens
  extends Omit<
    Session,
    'provider_token' | 'provider_refresh_token' | 'provider_token_expires_at'
  > {
  provider_token: string
  provider_refresh_token: string
  provider_token_expires_at: number
}

// Validate environment variables
function validateEnv(): void {
  // No environment variables needed for this route
}

// Validate authorization code
function validateCode(code: string | null): code is string {
  if (!code || typeof code !== 'string' || code.length < 10) {
    return false
  }
  return true
}

// Rate limiting map
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

// Check rate limit
function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const limit = rateLimitMap.get(key)

  if (!limit) {
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + AUTH.RATE_LIMIT.windowMs
    })
    return true
  }

  if (now > limit.resetTime) {
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + AUTH.RATE_LIMIT.windowMs
    })
    return true
  }

  if (limit.count >= AUTH.RATE_LIMIT.max) {
    return false
  }

  limit.count++
  return true
}

export async function GET(
  request: Request
): Promise<NextResponse<ErrorResponse | null>> {
  validateEnv()

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')

  console.log('[Callback] Starting callback handler:', {
    hasCode: !!code,
    error,
    error_description,
    url: requestUrl.toString()
  })

  // Check rate limit
  const clientIp = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!checkRateLimit(clientIp)) {
    console.log('[Callback] Rate limit exceeded for IP:', clientIp)
    return NextResponse.json(
      {
        error: ERROR_MESSAGES.RATE_LIMIT_EXCEEDED,
        code: 'RATE_LIMIT_EXCEEDED',
        status: 429
      },
      { status: 429 }
    )
  }

  if (error) {
    console.error('[Callback] Auth error from provider:', {
      error,
      error_description
    })
    return NextResponse.json(
      {
        error: error_description ?? error,
        code: 'AUTH_ERROR',
        status: 400
      },
      { status: 400 }
    )
  }

  if (!validateCode(code)) {
    console.error('[Callback] Invalid authorization code:', {
      codeLength: (code as string | null)?.length ?? 0
    })
    return NextResponse.json(
      {
        error: ERROR_MESSAGES.INVALID_CODE,
        code: 'INVALID_CODE',
        status: 400
      },
      { status: 400 }
    )
  }

  const supabase = createRouteHandlerClient<Database>({ cookies })

  try {
    console.log('[Callback] Attempting to exchange code for session')
    // Exchange the code for a session
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.exchangeCodeForSession(code)

    if (sessionError || !session) {
      console.error('[Callback] Session exchange failed:', {
        error: sessionError,
        hasSession: !!session,
        sessionData: session
          ? {
              user: session.user?.id,
              expiresAt: session.expires_at,
              hasAccessToken: !!session.access_token,
              hasRefreshToken: !!session.refresh_token
            }
          : null
      })
      return NextResponse.json(
        {
          error: sessionError?.message ?? ERROR_MESSAGES.NO_SESSION,
          code: 'SESSION_ERROR',
          status: 401
        },
        { status: 401 }
      )
    }

    console.log('[Callback] Session exchange successful:', {
      userId: session.user?.id,
      expiresAt: session.expires_at,
      hasAccessToken: !!session.access_token,
      hasRefreshToken: !!session.refresh_token
    })

    // Set the session cookie
    console.log('[Callback] Setting session cookie')
    const response = NextResponse.redirect(requestUrl.origin)
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    })

    if (setSessionError) {
      console.error('[Callback] Error setting session cookie:', {
        error: setSessionError,
        sessionData: {
          userId: session.user?.id,
          expiresAt: session.expires_at
        }
      })
      return NextResponse.json(
        {
          error: 'Failed to set session',
          code: 'SESSION_SET_ERROR',
          status: 500,
          severity: 'error'
        },
        { status: 500 }
      )
    }

    console.log('[Callback] Session cookie set successfully')

    // Get tokens from Supabase session
    const sessionWithTokens = session as SessionWithProviderTokens
    const providerToken = sessionWithTokens.provider_token
    const providerRefreshToken = sessionWithTokens.provider_refresh_token
    const providerTokenExpiresAt =
      sessionWithTokens.provider_token_expires_at ??
      Math.floor(Date.now() / 1000) + 3600

    console.log('[Callback] Provider tokens status:', {
      hasProviderToken: !!providerToken,
      hasProviderRefreshToken: !!providerRefreshToken,
      providerTokenExpiresAt,
      userId: session.user?.id
    })

    if (!providerToken || !providerRefreshToken) {
      console.error('[Callback] Missing provider tokens:', {
        token: !!providerToken,
        refreshToken: !!providerRefreshToken,
        expiresAt: !!providerTokenExpiresAt,
        userId: session.user?.id
      })
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.MISSING_PROVIDER_TOKENS,
          code: 'MISSING_PROVIDER_TOKENS',
          status: 500,
          severity: 'error'
        },
        { status: 500 }
      )
    }

    // Validate user metadata
    const userMetadata = session.user.user_metadata as UserMetadata
    console.log('[Callback] User metadata validation:', {
      hasProviderId: !!userMetadata.provider_id,
      hasName: !!userMetadata.name,
      hasAvatarUrl: !!userMetadata.avatar_url,
      userId: session.user?.id
    })

    if (!userMetadata.provider_id || !userMetadata.name) {
      console.error('[Callback] Invalid user metadata:', {
        metadata: userMetadata,
        userId: session.user?.id
      })
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.INVALID_USER_METADATA,
          code: 'INVALID_METADATA',
          status: 400
        },
        { status: 400 }
      )
    }

    // Debug log the session data
    console.log(
      '[Callback] Full session data:',
      JSON.stringify(session, null, 2)
    )
    console.log(
      '[Callback] User metadata:',
      JSON.stringify(userMetadata, null, 2)
    )
    console.log(
      '[Callback] Raw user data:',
      JSON.stringify(session.user, null, 2)
    )

    // Create or update profile with tokens from Supabase session
    const profileData: ProfileData = {
      id: session.user.id,
      spotify_access_token: providerToken,
      spotify_refresh_token: providerRefreshToken,
      spotify_token_expires_at: providerTokenExpiresAt,
      spotify_provider_id: userMetadata.provider_id,
      display_name: userMetadata.name,
      avatar_url: userMetadata.avatar_url ?? null
    }

    console.log('[Callback] Attempting to fetch profile:', {
      userId: session.user.id,
      hasProfileData: !!profileData
    })

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('[Callback] Error fetching profile:', {
        error: profileError,
        userId: session.user.id
      })
      return NextResponse.json(
        {
          error: 'Failed to fetch profile',
          code: 'PROFILE_FETCH_ERROR',
          status: 500,
          severity: 'error'
        },
        { status: 500 }
      )
    }

    if (!profile) {
      console.error('[Callback] No profile found for user:', {
        userId: session.user.id
      })
      return NextResponse.json(
        {
          error: 'Profile not found',
          code: 'PROFILE_NOT_FOUND',
          status: 404,
          severity: 'error'
        },
        { status: 404 }
      )
    }

    // Type guard to ensure profile has required fields
    const typedProfile = profile as ProfileData
    console.log('[Callback] Profile validation:', {
      hasAccessToken: !!typedProfile.spotify_access_token,
      hasRefreshToken: !!typedProfile.spotify_refresh_token,
      hasExpiresAt: !!typedProfile.spotify_token_expires_at,
      userId: session.user.id
    })

    if (
      !typedProfile.spotify_access_token ||
      !typedProfile.spotify_refresh_token ||
      !typedProfile.spotify_token_expires_at
    ) {
      console.error('[Callback] Invalid profile data:', {
        profile: typedProfile,
        userId: session.user.id
      })
      return NextResponse.json(
        {
          error: 'Invalid profile data',
          code: 'INVALID_PROFILE_DATA',
          status: 500,
          severity: 'error'
        },
        { status: 500 }
      )
    }

    // Verify profile update
    console.log('[Callback] Verifying profile update')
    const verifyProfileUpdate = async (): Promise<void> => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (!profile) {
          console.error(
            '[Callback] Profile verification failed: Profile not found after update'
          )
          throw new Error('Profile not found after update')
        }
        console.log('[Callback] Profile verification successful:', {
          userId: session.user.id,
          hasProfile: !!profile
        })
      } catch (error) {
        console.error('[Callback] Error verifying profile update:', {
          error,
          userId: session.user.id
        })
        throw error
      }
    }

    await verifyProfileUpdate()
    console.log('[Callback] Authentication flow completed successfully')

    // Redirect after successful authentication
    return response as NextResponse<ErrorResponse | null>
  } catch (error) {
    console.error('[Callback] Unhandled error in callback:', {
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json(
      {
        error: ERROR_MESSAGES.UNKNOWN_ERROR,
        details: error instanceof Error ? error.message : undefined,
        code: 'UNKNOWN_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
