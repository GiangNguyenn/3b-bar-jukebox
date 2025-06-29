import { createServerClient } from '@supabase/ssr'
import { type Session, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { type Database } from '@/types/supabase'
import { type SpotifyUserProfile } from '@/shared/types/spotify'

export class AuthService {
  private supabase: SupabaseClient<Database>

  constructor() {
    const cookieStore = cookies()
    this.supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing user sessions.
            }
          }
        }
      }
    )
  }

  async exchangeCodeForSession(code: string): Promise<Session> {
    const { data, error } =
      await this.supabase.auth.exchangeCodeForSession(code)
    if (error || !data.session) {
      throw new Error(error?.message ?? 'Failed to exchange code for session')
    }
    return data.session
  }

  async getSpotifyUserProfile(
    accessToken: string
  ): Promise<SpotifyUserProfile> {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      throw new Error('Failed to fetch Spotify user profile')
    }

    return response.json() as Promise<SpotifyUserProfile>
  }

  isPremiumUser(userProfile: SpotifyUserProfile): boolean {
    return (
      userProfile.product === 'premium' ||
      userProfile.product === 'premium_duo' ||
      userProfile.product === 'premium_family' ||
      userProfile.product === 'premium_student'
    )
  }

  async upsertUserProfile(
    profileData: Partial<Database['public']['Tables']['profiles']['Row']>
  ): Promise<void> {
    const { error } = await this.supabase.from('profiles').upsert(profileData)
    if (error) {
      // Log error but don't throw, as it's not critical for the auth flow
      console.error('Error upserting user profile:', error)
    }
  }
}
