/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { getBaseUrl } from '@/shared/utils/domain'

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

export async function GET(request: Request): Promise<NextResponse> {
  console.log('[Callback] Starting callback handler')
  console.log('[Callback] Request URL:', request.url)
  console.log(
    '[Callback] Request headers:',
    Object.fromEntries(request.headers.entries())
  )

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
          error: error_description ?? error,
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

    console.log('[Callback] Exchanging code for session')
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.exchangeCodeForSession(code)

    if (sessionError || !session) {
      console.error('[Callback] Session exchange failed:', sessionError)
      return NextResponse.json(
        {
          error: sessionError?.message ?? 'Failed to exchange code for session',
          code: 'SESSION_ERROR',
          status: 401
        },
        { status: 401 }
      )
    }

    console.log(
      '[Callback] Session exchange successful, user:',
      session.user.id
    )

    // Debug session data - comprehensive dump
    console.log('[Callback] Full session data:', {
      user: {
        id: session.user.id,
        email: session.user.email,
        user_metadata: session.user.user_metadata,
        app_metadata: session.user.app_metadata
      },
      session: {
        access_token: session.access_token ? 'present' : 'missing',
        refresh_token: session.refresh_token ? 'present' : 'missing',
        provider_token: session.provider_token ? 'present' : 'missing',
        provider_refresh_token: session.provider_refresh_token
          ? 'present'
          : 'missing',
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type
      },
      providerTokenLength: session.provider_token?.length ?? 0,
      providerRefreshTokenLength: session.provider_refresh_token?.length ?? 0
    })

    // Get the user's Spotify access token from the session
    const spotifyAccessToken = session.provider_token
    const spotifyRefreshToken = session.provider_refresh_token

    if (!spotifyAccessToken) {
      console.error('[Callback] No Spotify access token in session')
      console.error(
        '[Callback] Session provider_token:',
        session.provider_token
      )
      console.error(
        '[Callback] Session provider_refresh_token:',
        session.provider_refresh_token
      )

      // Try multiple fallback methods to get the Spotify token
      const possibleTokens = [
        session.user.user_metadata?.access_token,
        session.user.user_metadata?.spotify_access_token,
        session.user.app_metadata?.provider_token,
        session.user.app_metadata?.spotify_access_token
      ]

      console.log('[Callback] Trying fallback tokens:', {
        userMetadataAccessToken: !!session.user.user_metadata?.access_token,
        userMetadataSpotifyAccessToken:
          !!session.user.user_metadata?.spotify_access_token,
        appMetadataProviderToken: !!session.user.app_metadata?.provider_token,
        appMetadataSpotifyAccessToken:
          !!session.user.app_metadata?.spotify_access_token
      })

      const metadataToken = possibleTokens.find((token) => !!token)

      if (metadataToken) {
        console.log(
          '[Callback] Found token in fallback location, using that instead'
        )
        // Use the token from metadata
        const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
          headers: {
            Authorization: `Bearer ${metadataToken}`
          }
        })

        if (spotifyResponse.ok) {
          const userData: SpotifyUserProfile = await spotifyResponse.json()
          console.log('[Callback] Spotify API response from fallback token:', {
            product: userData.product,
            display_name: userData.display_name
          })

          // Check if user has premium (including all premium variants)
          const isPremium =
            userData.product === 'premium' ||
            userData.product === 'premium_duo' ||
            userData.product === 'premium_family' ||
            userData.product === 'premium_student'

          const productType = userData.product

          console.log('[Callback] Premium check result from fallback token:', {
            isPremium,
            productType,
            userProduct: userData.product
          })

          // Store the user's profile with fallback token
          const { error: updateError } = await supabase
            .from('profiles')
            .upsert({
              id: session.user.id,
              display_name:
                session.user.user_metadata?.name ??
                session.user.email ??
                'Unknown',
              spotify_user_id:
                session.user.user_metadata?.sub ?? session.user.id,
              spotify_access_token: metadataToken,
              spotify_refresh_token:
                session.user.user_metadata?.refresh_token ??
                session.user.app_metadata?.provider_refresh_token,
              spotify_token_expires_at: session.expires_at,
              is_premium: isPremium,
              spotify_product_type: productType,
              premium_verified_at: new Date().toISOString()
            })

          if (updateError) {
            console.error(
              '[Callback] Error updating user profile:',
              updateError
            )
          } else {
            console.log(
              '[Callback] User profile updated successfully with fallback token'
            )
          }

          // Redirect based on premium status
          const baseUrl = getBaseUrl()
          let redirectUrl: URL
          if (isPremium) {
            redirectUrl = new URL(
              `/${session.user.user_metadata?.name ?? 'admin'}/admin`,
              baseUrl
            )
            console.log(
              '[Callback] Redirecting premium user to admin:',
              redirectUrl.toString()
            )
          } else {
            redirectUrl = new URL('/premium-required', baseUrl)
            console.log(
              '[Callback] Redirecting non-premium user to premium required page:',
              redirectUrl.toString()
            )
          }

          return NextResponse.redirect(redirectUrl)
        } else {
          console.error(
            '[Callback] Spotify API error with fallback token:',
            spotifyResponse.status,
            spotifyResponse.statusText
          )
        }
      }

      // If we still don't have a token, redirect to sign in with an error
      console.error('[Callback] No Spotify token found in any location')
      return NextResponse.json(
        {
          error:
            'No Spotify access token received. Please check your Supabase OAuth configuration.',
          code: 'NO_SPOTIFY_TOKEN',
          status: 400
        },
        { status: 400 }
      )
    }

    console.log('[Callback] Got Spotify access token, verifying premium status')

    // Verify premium status using the user's Spotify access token
    let isPremium = false
    let productType = 'unknown'

    try {
      console.log('[Callback] Making Spotify API call to /me endpoint')
      const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          Authorization: `Bearer ${spotifyAccessToken}`
        }
      })

      console.log(
        '[Callback] Spotify API response status:',
        spotifyResponse.status
      )

      if (spotifyResponse.ok) {
        const userData: SpotifyUserProfile = await spotifyResponse.json()
        console.log('[Callback] Spotify API response:', {
          product: userData.product,
          display_name: userData.display_name,
          id: userData.id,
          email: userData.email
        })

        // Check if user has premium (including all premium variants)
        isPremium =
          userData.product === 'premium' ||
          userData.product === 'premium_duo' ||
          userData.product === 'premium_family' ||
          userData.product === 'premium_student'

        productType = userData.product

        console.log(
          '[Callback] Premium status determined:',
          isPremium,
          'for product type:',
          userData.product,
          'Premium variants checked:',
          ['premium', 'premium_duo', 'premium_family', 'premium_student']
        )
      } else {
        const errorText = await spotifyResponse.text()
        console.error('[Callback] Spotify API error:', {
          status: spotifyResponse.status,
          statusText: spotifyResponse.statusText,
          errorText
        })
      }
    } catch (apiError) {
      console.error('[Callback] Error calling Spotify API:', apiError)
    }

    // Store the user's Spotify tokens and premium status in their profile
    const { error: updateError } = await supabase.from('profiles').upsert({
      id: session.user.id,
      display_name:
        session.user.user_metadata?.name ?? session.user.email ?? 'Unknown',
      spotify_user_id: session.user.user_metadata?.sub ?? session.user.id,
      spotify_access_token: spotifyAccessToken,
      spotify_refresh_token: spotifyRefreshToken,
      spotify_token_expires_at: session.expires_at,
      is_premium: isPremium,
      spotify_product_type: productType,
      premium_verified_at: new Date().toISOString()
    })

    if (updateError) {
      console.error('[Callback] Error updating user profile:', updateError)
    } else {
      console.log('[Callback] User profile updated successfully')
    }

    // Use the domain utility to get the correct base URL for redirects
    const baseUrl = getBaseUrl()
    console.log('[Callback] Using base URL for redirect:', baseUrl)

    // Redirect based on premium status
    let redirectUrl: URL
    console.log('[Callback] Final redirect decision:', {
      isPremium,
      productType,
      userDisplayName:
        session.user.user_metadata?.name ?? session.user.email ?? 'Unknown'
    })

    if (isPremium) {
      // Premium user - redirect to admin page
      redirectUrl = new URL(
        `/${session.user.user_metadata?.name ?? 'admin'}/admin`,
        baseUrl
      )
      console.log(
        '[Callback] Redirecting premium user to admin:',
        redirectUrl.toString()
      )
    } else {
      // Non-premium user - redirect to premium required page
      redirectUrl = new URL('/premium-required', baseUrl)
      console.log(
        '[Callback] Redirecting non-premium user to premium required page:',
        redirectUrl.toString()
      )
    }

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
