import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/supabase'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

interface Profile {
  id: string
  display_name: string
  spotify_user_id: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export function useGetProfile(displayName: string) {
  const [data, setData] = useState<Profile | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClientComponentClient<Database>()

  useEffect(() => {
    let isMounted = true

    async function fetchProfile() {
      if (!isMounted) return

      try {
        setIsLoading(true)
        setError(null)

        // Format the display name for the query
        const formattedDisplayName = displayName.trim()
        console.log(
          '[GetProfile] Attempting to fetch profile for display name:',
          {
            original: displayName,
            formatted: formattedDisplayName,
            query: `%${formattedDisplayName}%`
          }
        )

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .filter('display_name', 'ilike', `%${formattedDisplayName}%`)
          .single()

        if (!isMounted) return

        if (profileError) {
          console.error('[GetProfile] Supabase error:', {
            code: profileError.code,
            message: profileError.message,
            details: profileError.details,
            hint: profileError.hint
          })
          throw new AppError(
            ERROR_MESSAGES.FAILED_TO_FETCH_PROFILE,
            profileError,
            'GetProfile'
          )
        }

        if (!profile) {
          console.log(
            '[GetProfile] No profile found for display name:',
            formattedDisplayName
          )
          throw new AppError(
            ERROR_MESSAGES.PROFILE_NOT_FOUND,
            null,
            'GetProfile'
          )
        }

        console.log('[GetProfile] Successfully fetched profile:', {
          id: profile.id,
          display_name: profile.display_name,
          spotify_user_id: profile.spotify_user_id
        })

        setData(profile)
      } catch (error) {
        if (!isMounted) return

        console.error('[GetProfile] Error:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          name: error instanceof Error ? error.name : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined,
          cause: error instanceof Error ? error.cause : undefined
        })
        setError(
          error instanceof AppError
            ? error
            : new AppError(
                ERROR_MESSAGES.FAILED_TO_FETCH_PROFILE,
                error,
                'GetProfile'
              )
        )
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void fetchProfile()

    return () => {
      isMounted = false
    }
  }, [displayName, supabase])

  return { data, error, isLoading }
}
