import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyUserProfile } from '@/shared/types/spotify'

interface PremiumStatus {
  isPremium: boolean
  productType: string
  isLoading: boolean
  error: string | null
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
    error: null
  })

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const checkPremiumStatus = useCallback(
    async (force = false): Promise<void> => {
      try {
        setStatus((prev) => ({ ...prev, isLoading: true, error: null }))

        // Check if user is authenticated
        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (!session) {
          setStatus({
            isPremium: false,
            productType: '',
            isLoading: false,
            error: 'No session found'
          })
          return
        }

        // Call the premium verification API
        const apiUrl = force
          ? '/api/auth/verify-premium?force=true'
          : '/api/auth/verify-premium'
        const response = await fetch(apiUrl, {
          method: 'GET',
          credentials: 'include'
        })

        if (!response.ok) {
          const errorData = await response.json()
          addLog(
            'ERROR',
            `API error: ${JSON.stringify(errorData)}`,
            'usePremiumStatus'
          )
          throw new Error(errorData.error || 'Failed to verify premium status')
        }

        const data = (await response.json()) as PremiumVerificationResponse

        setStatus({
          isPremium: data.isPremium,
          productType: data.productType,
          isLoading: false,
          error: null
        })
      } catch (error) {
        addLog(
          'ERROR',
          'Error checking premium status:',
          'usePremiumStatus',
          error instanceof Error ? error : undefined
        )
        setStatus({
          isPremium: false,
          productType: '',
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error'
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
