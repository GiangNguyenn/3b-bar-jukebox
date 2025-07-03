import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyUserProfile } from '@/shared/types/spotify'
import { tokenManager } from '@/shared/token/tokenManager'

interface PremiumStatus {
  isPremium: boolean
  productType: string
  isLoading: boolean
  error: string | null
  needsReauth: boolean
}

interface PremiumVerificationResponse {
  isPremium: boolean
  productType: string
  userProfile?: SpotifyUserProfile
  cached: boolean
}

export function usePremiumStatus(): PremiumStatus & {
  refreshPremiumStatus: () => Promise<void>
  forceRefreshPremiumStatus: () => Promise<void>
} {
  const { addLog } = useConsoleLogsContext()
  const [status, setStatus] = useState<PremiumStatus>({
    isPremium: false,
    productType: '',
    isLoading: true,
    error: null,
    needsReauth: false
  })

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const checkPremiumStatus = useCallback(
    async (force = false): Promise<void> => {
      try {
        setStatus((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          needsReauth: false
        }))

        // Step 1: Check if user is authenticated with Supabase
        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (!session) {
          setStatus({
            isPremium: false,
            productType: '',
            isLoading: false,
            error: 'No session found',
            needsReauth: false
          })
          return
        }

        // Step 2: Check if user has valid Spotify authentication
        try {
          const spotifyToken = await tokenManager.getToken()
        } catch (tokenError) {
          setStatus({
            isPremium: false,
            productType: '',
            isLoading: false,
            error: 'Spotify authentication required',
            needsReauth: true
          })
          return
        }

        // Step 3: Now that we have valid Spotify authentication, verify premium status
        const apiUrl = force
          ? '/api/auth/verify-premium?force=true'
          : '/api/auth/verify-premium'
        const response = await fetch(apiUrl, {
          method: 'GET',
          credentials: 'include'
        })

        if (!response.ok) {
          const errorData = await response.json()

          // Handle specific authentication errors
          if (
            errorData.code === 'NO_SPOTIFY_TOKEN' ||
            errorData.code === 'INVALID_SPOTIFY_TOKEN'
          ) {
            setStatus({
              isPremium: false,
              productType: '',
              isLoading: false,
              error: errorData.error,
              needsReauth: true
            })
            return
          }

          throw new Error(errorData.error || 'Failed to verify premium status')
        }

        const data = (await response.json()) as PremiumVerificationResponse

        setStatus({
          isPremium: data.isPremium,
          productType: data.productType,
          isLoading: false,
          error: null,
          needsReauth: false
        })
      } catch (error) {
        setStatus({
          isPremium: false,
          productType: '',
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          needsReauth: false
        })
      }
    },
    [supabase, addLog]
  )

  const refreshPremiumStatus = useCallback(async (): Promise<void> => {
    await checkPremiumStatus(false)
  }, [checkPremiumStatus])

  const forceRefreshPremiumStatus = useCallback(async (): Promise<void> => {
    await checkPremiumStatus(true)
  }, [checkPremiumStatus])

  useEffect(() => {
    void checkPremiumStatus(false)
  }, [checkPremiumStatus])

  return {
    ...status,
    refreshPremiumStatus,
    forceRefreshPremiumStatus
  }
}
