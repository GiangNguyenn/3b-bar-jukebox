import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { queryWithRetry } from '@/lib/supabaseQuery'

interface Profile {
  avatar_url: string | null
  created_at: string
  display_name: string
  id: string
  is_premium: boolean | null
  premium_verified_at: string | null
  spotify_access_token: string | null
  spotify_product_type: string | null
  spotify_provider_id: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
  spotify_user_id: string
  subscription_id: string | null
  updated_at: string
}

interface UseGetProfileReturn {
  profile: Profile | null
  loading: boolean
  error: string | null
}

export function useGetProfile(): UseGetProfileReturn {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = supabaseBrowser

  useEffect(() => {
    async function getProfile() {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser()

        if (!user) {
          setProfile(null)
          setLoading(false)
          return
        }

        const { data, error } = await queryWithRetry<Profile>(
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          undefined,
          `Fetch profile for userId: ${user.id}`
        )

        if (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'object' &&
                  error !== null &&
                  'message' in error
                ? String(error.message)
                : 'An error occurred'
          setError(errorMessage)
        } else {
          setProfile(data)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    getProfile()
  }, [supabase])

  return { profile, loading, error }
}
