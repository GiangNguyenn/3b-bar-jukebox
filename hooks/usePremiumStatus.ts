import { useState, useEffect, useCallback, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyUserProfile } from '@/shared/types/spotify'
import { tokenManager } from '@/shared/token/tokenManager'
import { safeParsePremiumVerificationResponse } from '@/shared/validations/tokenSchemas'

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

  const supabase = useMemo(
    () =>
      createBrowserClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
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
          await tokenManager.getToken()
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
          const errorDataRaw = await response.json()
          // Type guard for error response structure
          if (
            typeof errorDataRaw === 'object' &&
            errorDataRaw !== null &&
            'code' in errorDataRaw &&
            'error' in errorDataRaw
          ) {
            const errorData = errorDataRaw as { code: string; error: string }
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

          throw new Error('Failed to verify premium status')
        }

        const dataRaw = await response.json()
        const parseResult = safeParsePremiumVerificationResponse(dataRaw)

        if (!parseResult.success) {
          addLog(
            'ERROR',
            'Invalid premium verification response format',
            'usePremiumStatus'
          )
          setStatus({
            isPremium: false,
            productType: '',
            isLoading: false,
            error: 'Invalid response from server',
            needsReauth: false
          })
          return
        }

        const data = parseResult.data

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
