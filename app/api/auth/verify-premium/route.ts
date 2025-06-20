import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { sendApiRequest } from '@/shared/api'

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

export async function GET(): Promise<
  NextResponse<PremiumVerificationResponse | ErrorResponse>
> {
  console.log('[verify-premium] Starting premium verification')
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

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    console.log('[verify-premium] No user found')
    return NextResponse.json({ 
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED',
      status: 401
    }, { status: 401 })
  }

  console.log('[verify-premium] User found:', user.id)

  try {
    // Get user's profile to check if premium status is already verified
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_premium, premium_verified_at')
      .eq('id', user.id)
      .single()

    console.log('[verify-premium] Profile data:', profile)

    // If premium status was verified recently (within 24 hours), return cached result
    if (profile?.premium_verified_at) {
      const verifiedAt = new Date(profile.premium_verified_at)
      const now = new Date()
      const hoursSinceVerification = (now.getTime() - verifiedAt.getTime()) / (1000 * 60 * 60)
      
      console.log('[verify-premium] Hours since verification:', hoursSinceVerification)
      
      if (hoursSinceVerification < 24) {
        console.log('[verify-premium] Using cached premium status:', profile.is_premium)
        return NextResponse.json({ 
          isPremium: profile.is_premium,
          productType: profile.is_premium ? 'premium' : 'free',
          cached: true 
        })
      }
    }

    console.log('[verify-premium] Calling Spotify API to verify premium status')

    // Call Spotify API to verify premium status
    try {
      // Get the user's Spotify access token from their profile
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('spotify_access_token')
        .eq('id', user.id)
        .single()

      if (!userProfile?.spotify_access_token) {
        console.error('[verify-premium] No Spotify access token found for user')
        return NextResponse.json({ 
          error: 'No Spotify access token found',
          code: 'NO_SPOTIFY_TOKEN',
          status: 400
        }, { status: 400 })
      }

      // Call Spotify API directly with user's access token
      const spotifyResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${userProfile.spotify_access_token}`
        }
      })

      if (!spotifyResponse.ok) {
        console.error('[verify-premium] Spotify API error:', spotifyResponse.status)
        return NextResponse.json({ 
          error: 'Failed to verify premium status with Spotify',
          code: 'SPOTIFY_API_ERROR',
          status: 500
        }, { status: 500 })
      }

      const userData = (await spotifyResponse.json()) as SpotifyUserProfile
      console.log('[verify-premium] Spotify API response:', {
        product: userData.product,
        display_name: userData.display_name
      })
      
      // Check if user has premium (including all premium variants)
      const isPremium = userData.product === 'premium' || 
                       userData.product === 'premium_duo' || 
                       userData.product === 'premium_family' ||
                       userData.product === 'premium_student'
      
      console.log('[verify-premium] Premium status determined:', isPremium, 'for product type:', userData.product)

      // Update profile with premium status
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          is_premium: isPremium,
          premium_verified_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) {
        console.error('[verify-premium] Error updating premium status:', updateError)
      } else {
        console.log('[verify-premium] Premium status updated in database')
      }

      return NextResponse.json({ 
        isPremium,
        productType: userData.product,
        userProfile: userData,
        cached: false
      })
    } catch (apiError) {
      console.error('[verify-premium] Error calling Spotify API:', apiError)
      return NextResponse.json({ 
        error: 'Failed to verify premium status',
        code: 'SPOTIFY_API_ERROR',
        status: 500
      }, { status: 500 })
    }
  } catch (error) {
    console.error('[verify-premium] Error verifying premium status:', error)
    return NextResponse.json({ 
      error: 'Failed to verify premium status',
      code: 'VERIFICATION_ERROR',
      status: 500
    }, { status: 500 })
  }
} 