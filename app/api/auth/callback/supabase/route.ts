/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createServerClient } from '@supabase/ssr'
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
  MISSING_PROVIDER_TOKENS: 'Missing provider tokens',
  PREMIUM_REQUIRED: 'Spotify Premium account required'
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
  spotify_product_type?: string
  is_premium?: boolean
}

interface SpotifyUserProfile {
  id: string
  display_name: string
  email: string
  product: string // 'premium', 'free', 'open', 'premium_duo', 'premium_family', etc.
  type: string
  uri: string
  href: string
  images?: Array<{
    url: string
    height: number
    width: number
  }>
  external_urls: {
    spotify: string
  }
  followers: {
    href: string | null
    total: number
  }
  country: string
  explicit_content: {
    filter_enabled: boolean
    filter_locked: boolean
  }
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
  const requiredEnvVars = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }
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

// Verify premium status with Spotify API
async function verifyPremiumStatus(accessToken: string): Promise<{
  isPremium: boolean
  productType: string
  userProfile: SpotifyUserProfile
}> {
  console.log('[verifyPremiumStatus] Starting premium verification with access token:', {
    hasToken: !!accessToken,
    tokenLength: accessToken?.length
  })

  try {
    const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    console.log('[verifyPremiumStatus] Spotify API response:', {
      status: spotifyResponse.status,
      statusText: spotifyResponse.statusText,
      ok: spotifyResponse.ok
    })

    if (!spotifyResponse.ok) {
      const errorText = await spotifyResponse.text()
      console.error('[verifyPremiumStatus] Spotify API error response:', {
        status: spotifyResponse.status,
        statusText: spotifyResponse.statusText,
        errorText
      })
      throw new Error(`Error getting user profile from external provider: ${spotifyResponse.status} ${spotifyResponse.statusText}`)
    }

    const userProfile = (await spotifyResponse.json()) as SpotifyUserProfile

    console.log('[verifyPremiumStatus] Successfully retrieved user profile:', {
      userId: userProfile.id,
      displayName: userProfile.display_name,
      product: userProfile.product,
      email: userProfile.email
    })

    // Check if user has premium
    const isPremium = userProfile.product === 'premium' || 
                     userProfile.product === 'premium_duo' || 
                     userProfile.product === 'premium_family' ||
                     userProfile.product === 'premium_student'

    console.log('[verifyPremiumStatus] Premium status determined:', {
      isPremium,
      productType: userProfile.product
    })

    return {
      isPremium,
      productType: userProfile.product,
      userProfile
    }
  } catch (error) {
    console.error('[verifyPremiumStatus] Error in premium verification:', {
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}

export async function GET(
  request: Request
): Promise<NextResponse> {
  console.log('[Callback] Starting callback handler')
  console.log('[Callback] Request URL:', request.url)
  console.log('[Callback] Request headers:', Object.fromEntries(request.headers.entries()))
  
  try {
    validateEnv()

    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const error = requestUrl.searchParams.get('error')
    const error_description = requestUrl.searchParams.get('error_description')

    console.log('[Callback] URL parameters:', {
      hasCode: !!code,
      error,
      error_description,
      url: requestUrl.toString()
    })

    // Handle OAuth errors
    if (error) {
      console.log('[Callback] OAuth error:', { error, error_description })
      return NextResponse.json(
        {
          error: error_description || error,
          code: 'OAUTH_ERROR',
          status: 400
        },
        { status: 400 }
      )
    }

    if (!code) {
      console.log('[Callback] No authorization code')
      return NextResponse.json(
        {
          error: 'No authorization code',
          code: 'NO_CODE',
          status: 400
        },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
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
          },
        },
      }
    )

    console.log('[Callback] Exchanging code for session')
    const { data: { session }, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

    if (sessionError || !session) {
      console.error('[Callback] Session exchange failed:', sessionError)
      return NextResponse.json(
        {
          error: sessionError?.message || 'Failed to exchange code for session',
          code: 'SESSION_ERROR',
          status: 401
        },
        { status: 401 }
      )
    }

    console.log('[Callback] Session exchange successful, redirecting to admin')
    
    // Redirect to admin page
    const redirectUrl = new URL(`/${session.user.user_metadata?.name || 'admin'}/admin`, requestUrl.origin)
    return NextResponse.redirect(redirectUrl)
    
  } catch (error) {
    console.error('[Callback] Unexpected error:', error)
    return NextResponse.json(
      {
        error: 'Unexpected error during authentication',
        code: 'UNEXPECTED_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
