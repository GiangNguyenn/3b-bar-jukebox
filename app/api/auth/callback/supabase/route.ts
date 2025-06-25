/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { getBaseUrl } from '@/shared/utils/domain'
import { SpotifyUserProfile } from '@/shared/types/spotify'

// Mark this route as dynamic since it uses request.url for OAuth callback
export const dynamic = 'force-dynamic'

// Validate environment variables
function validateEnv(): void {
  const requiredEnvVars = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    )
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    validateEnv()

    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const error = requestUrl.searchParams.get('error')
    const error_description = requestUrl.searchParams.get('error_description')

    // Handle OAuth errors
    if (error) {
      return NextResponse.json(
        {
          error: error_description ?? error,
          code: 'OAUTH_ERROR',
          status: 400
        },
        { status: 400 }
      )
    }

    if (!code) {
      return NextResponse.json(
        {
          error: 'No authorization code',
          code: 'NO_CODE',
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

    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.exchangeCodeForSession(code)

    if (sessionError || !session) {
      return NextResponse.json(
        {
          error: sessionError?.message ?? 'Failed to exchange code for session',
          code: 'SESSION_ERROR',
          status: 401
        },
        { status: 401 }
      )
    }

    // Get the user's Spotify access token from the session
    const spotifyAccessToken = session.provider_token
    const spotifyRefreshToken = session.provider_refresh_token

    if (!spotifyAccessToken) {
      // Try multiple fallback methods to get the Spotify token
      const possibleTokens = [
        session.user.user_metadata?.access_token,
        session.user.user_metadata?.spotify_access_token,
        session.user.app_metadata?.provider_token,
        session.user.app_metadata?.spotify_access_token
      ]

      const metadataToken = possibleTokens.find((token) => !!token)

      if (metadataToken) {
        // Use the token from metadata
        const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
          headers: {
            Authorization: `Bearer ${metadataToken}`
          }
        })

        if (spotifyResponse.ok) {
          const userData: SpotifyUserProfile = await spotifyResponse.json()

          // Check if user has premium (including all premium variants)
          const isPremium =
            userData.product === 'premium' ||
            userData.product === 'premium_duo' ||
            userData.product === 'premium_family' ||
            userData.product === 'premium_student'

          const productType = userData.product

          // Store the user's profile with fallback token
          const { error: updateError } = await supabase
            .from('profiles')
            .upsert({
              id: session.user.id,
              spotify_user_id: userData.id,
              display_name: userData.display_name,
              avatar_url: userData.images?.[0]?.url || null,
              is_premium: isPremium,
              spotify_product_type: productType,
              spotify_access_token: metadataToken,
              spotify_refresh_token: session.provider_refresh_token,
              spotify_token_expires_at: Math.floor(Date.now() / 1000) + 3600, // Assume 1 hour
              premium_verified_at: new Date().toISOString()
            })

          if (updateError) {
            // Log error but continue
          }

          // Redirect based on premium status
          const baseUrl = getBaseUrl()
          let redirectUrl: URL

          if (isPremium) {
            redirectUrl = new URL(`/${userData.display_name}/admin`, baseUrl)
          } else {
            redirectUrl = new URL('/premium-required', baseUrl)
          }

          return NextResponse.redirect(redirectUrl)
        } else {
          // Continue to error handling
        }
      }

      // If we still don't have a token, redirect to sign in with an error
      return NextResponse.json(
        {
          error: 'No Spotify access token found. Please sign in again.',
          code: 'NO_SPOTIFY_TOKEN',
          status: 400
        },
        { status: 400 }
      )
    }

    // Verify premium status using the user's Spotify access token
    let isPremium = false
    let productType = 'free'

    try {
      const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          Authorization: `Bearer ${spotifyAccessToken}`
        }
      })

      if (spotifyResponse.ok) {
        const userData: SpotifyUserProfile = await spotifyResponse.json()

        // Check if user has premium (including all premium variants)
        isPremium =
          userData.product === 'premium' ||
          userData.product === 'premium_duo' ||
          userData.product === 'premium_family' ||
          userData.product === 'premium_student'

        productType = userData.product
      } else {
        // Log error but continue
      }
    } catch {
      // Log error but continue
    }

    // Update user profile with Spotify information
    const { error: updateError } = await supabase.from('profiles').upsert({
      id: session.user.id,
      spotify_user_id: session.user.id, // Use user ID as spotify_user_id for now
      display_name:
        session.user.user_metadata?.name ??
        session.user.email?.split('@')[0] ??
        'Unknown',
      avatar_url: session.user.user_metadata?.avatar_url ?? null,
      is_premium: isPremium,
      spotify_product_type: productType,
      spotify_access_token: spotifyAccessToken,
      spotify_refresh_token: spotifyRefreshToken,
      spotify_token_expires_at: Math.floor(Date.now() / 1000) + 3600, // Assume 1 hour
      premium_verified_at: new Date().toISOString()
    })

    if (updateError) {
      // Log error but continue
    }

    // Use the domain utility to get the correct base URL for redirects
    const baseUrl = getBaseUrl()

    // Redirect based on premium status
    let redirectUrl: URL

    if (isPremium) {
      redirectUrl = new URL(
        `/${session.user.user_metadata?.name ?? session.user.email?.split('@')[0] ?? 'user'}/admin`,
        baseUrl
      )
    } else {
      // Non-premium user - redirect to premium required page
      redirectUrl = new URL('/premium-required', baseUrl)
    }

    return NextResponse.redirect(redirectUrl)
  } catch {
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
