import { createServerClient } from '@supabase/ssr'
import { type Session, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { type Database } from '@/types/supabase'
import { type SpotifyUserProfile } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('AuthService')

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
      const errorMessage =
        error?.message ?? 'Failed to exchange code for session'
      throw new Error(errorMessage)
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
    // First attempt: try to upsert with the original display_name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await this.supabase
      .from('profiles')
      .upsert(profileData as any)

    if (error) {
      // Check if it's a unique constraint violation on display_name
      const errorCode = typeof error.code === 'string' ? error.code : undefined
      const errorMessage =
        typeof error.message === 'string' ? error.message : undefined

      if (errorCode === '23505' && errorMessage?.includes('display_name')) {
        logger(
          'INFO',
          `Display name "${profileData.display_name}" is already taken, using spotify_user_id as fallback`
        )

        // Retry with spotify_user_id as display_name
        const fallbackProfileData = {
          ...profileData,
          display_name: profileData.spotify_user_id
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: fallbackError } = await this.supabase
          .from('profiles')
          .upsert(fallbackProfileData as any)

        if (fallbackError) {
          logger(
            'ERROR',
            'Error upserting user profile with fallback display_name',
            'AuthService',
            fallbackError
          )
          throw new Error(
            'Failed to create user profile with unique display name'
          )
        }

        // Update the original profileData to reflect the change
        Object.assign(profileData, fallbackProfileData)
      } else {
        // Log other errors but don't throw, as it's not critical for the auth flow
        logger('ERROR', 'Error upserting user profile', 'AuthService', error)
      }
    }
  }
}
