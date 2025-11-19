import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { queryWithRetry } from '@/lib/supabaseQuery'

type Profile = Database['public']['Tables']['profiles']['Row']

export function useGetProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

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
