import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
// createModuleLogger removed to fix lint
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

// No-op logger removed to fix lint

export async function GET(): Promise<
  NextResponse<PremiumVerificationResponse | ErrorResponse>
> {
  // We are now treating all users as premium, so we always return true.
  // We still check for authentication to ensure the user is logged in.

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

  // Mock Spotify profile data
  const mockSpotifyProfile: SpotifyUserProfile = {
    display_name: 'Premium User',
    external_urls: { spotify: '' },
    href: '',
    id: user.id,
    images: [],
    type: 'user',
    uri: '',
    followers: { href: null, total: 0 },
    product: 'premium'
  }

  return NextResponse.json({
    isPremium: true,
    productType: 'premium',
    userProfile: mockSpotifyProfile,
    cached: false
  })
}
