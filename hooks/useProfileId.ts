'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase-browser'

/**
 * Hook to get the profile ID from the URL username parameter.
 * Also allows passing a username explicitly.
 */
export function useProfileId(explicitUsername?: string) {
  const params = useParams()
  // Use explicit username if provided, otherwise try to get from URL params
  const rawUsername = explicitUsername || params?.username
  // Handle case where params.username might be string | string[]
  const username = typeof rawUsername === 'string' ? rawUsername : undefined

  const [profileId, setProfileId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!username) {
      setIsLoading(false)
      return
    }

    let isMounted = true
    setIsLoading(true)
    setError(null)

    supabaseBrowser
      .from('profiles')
      .select('id')
      .ilike('display_name', username)
      .single<{ id: string }>()
      .then(({ data, error: fetchError }) => {
        if (!isMounted) return

        if (fetchError) {
          console.warn(
            '[useProfileId] profile lookup error:',
            fetchError.message
          )
          setError(fetchError.message)
        } else if (data) {
          setProfileId(data.id)
        }
        setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [username])

  return { profileId, isLoading, error, username }
}
