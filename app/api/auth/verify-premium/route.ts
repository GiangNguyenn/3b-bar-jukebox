import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { SpotifyUserProfile } from '@/shared/types/spotify'

interface PremiumVerificationResponse {
  isPremium: boolean
  productType: string
  userProfile?: SpotifyUserProfile
  cached?: boolean
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

// Set up logger for this module
const logger = createModuleLogger('verify-premium')

export async function GET(
  request: Request
): Promise<NextResponse<PremiumVerificationResponse | ErrorResponse>> {
  // Check for force refresh parameter
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get('force') === 'true'

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
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      {
        error: 'Not authenticated',
        code: 'NOT_AUTHENTICATED',
        status: 401
      },
      { status: 401 }
    )
  }

  try {
    // Get user's profile to check if premium status is already verified
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_premium, premium_verified_at, spotify_product_type')
      .eq('id', user.id)
      .single()

    // If premium status was verified recently (within 24 hours), return cached result
    if (profile?.premium_verified_at && !forceRefresh) {
      const verifiedAt = new Date(profile.premium_verified_at as string)
      const now = new Date()
      const hoursSinceVerification =
        (now.getTime() - verifiedAt.getTime()) / (1000 * 60 * 60)

      if (hoursSinceVerification < 24) {
        return NextResponse.json({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          isPremium: profile.is_premium ?? false,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          productType:
            profile.spotify_product_type ??
            (profile.is_premium ? 'premium' : 'free'),
          cached: true
        })
      }
    }

    // Call Spotify API to verify premium status
    try {
      // Get the user's Spotify access token from their profile
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('spotify_access_token')
        .eq('id', user.id)
        .single()

      if (!userProfile?.spotify_access_token) {
        logger(
          'ERROR',
          'No Spotify access token found for user',
          'verify-premium'
        )
        return NextResponse.json(
          {
            error: 'No Spotify access token found. Please sign in again.',
            code: 'NO_SPOTIFY_TOKEN',
            status: 400
          },
          { status: 400 }
        )
      }

      // Call Spotify API directly with user's access token
      const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          Authorization: `Bearer ${userProfile.spotify_access_token}`
        }
      })

      if (!spotifyResponse.ok) {
        const errorText = await spotifyResponse.text()
        logger(
          'ERROR',
          `Spotify API error: ${spotifyResponse.status} ${spotifyResponse.statusText} ${errorText}`,
          'verify-premium'
        )

        // If token is invalid (401), suggest re-authentication
        if (spotifyResponse.status === 401) {
          return NextResponse.json(
            {
              error: 'Spotify access token is invalid. Please sign in again.',
              code: 'INVALID_SPOTIFY_TOKEN',
              status: 401
            },
            { status: 401 }
          )
        }

        return NextResponse.json(
          {
            error: 'Failed to verify premium status with Spotify',
            code: 'SPOTIFY_API_ERROR',
            status: spotifyResponse.status
          },
          { status: spotifyResponse.status }
        )
      }

      const responseText = await spotifyResponse.text()

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const userData: SpotifyUserProfile = JSON.parse(responseText)

      // Check if user has premium (including all premium variants)
      const isPremium =
        userData.product === 'premium' ||
        userData.product === 'premium_duo' ||
        userData.product === 'premium_family' ||
        userData.product === 'premium_student'

      const productType = userData.product

      // Update profile with premium status
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          is_premium: isPremium,
          spotify_product_type: productType,
          premium_verified_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) {
        logger(
          'ERROR',
          `Error updating premium status: ${JSON.stringify(updateError)}`,
          'verify-premium'
        )
      }

      return NextResponse.json({
        isPremium,
        productType,
        userProfile: userData,
        cached: false
      })
    } catch (apiError) {
      logger(
        'ERROR',
        'Error calling Spotify API:',
        'verify-premium',
        apiError instanceof Error ? apiError : undefined
      )
      return NextResponse.json(
        {
          error: 'Failed to call Spotify API',
          code: 'SPOTIFY_API_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }
  } catch (error) {
    logger(
      'ERROR',
      'Error verifying premium status:',
      'verify-premium',
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
