import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

interface PremiumStatus {
  isPremium: boolean
  productType: string
  isLoading: boolean
  error: string | null
}

interface SpotifyUserProfile {
  id: string
  display_name: string
  email: string
  product: string
  type: string
  uri: string
  href: string
  images?: Array<{
    url: string
    height: number
    width: number
  }>
  external_urls: {
    spotify: string
  }
  followers: {
    href: string | null
    total: number
  }
  country: string
  explicit_content: {
    filter_enabled: boolean
    filter_locked: boolean
  }
}

interface PremiumVerificationResponse {
  isPremium: boolean
  productType: string
  userProfile?: SpotifyUserProfile
}

export function usePremiumStatus(): PremiumStatus & {
  refreshPremiumStatus: () => Promise<void>
} {
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

  const checkPremiumStatus = useCallback(async (): Promise<void> => {
    try {
      console.log('[usePremiumStatus] Starting premium status check')
      setStatus(prev => ({ ...prev, isLoading: true, error: null }))

      // Check if user is authenticated
      const {
        data: { session }
      } = await supabase.auth.getSession()

      if (!session) {
        console.log('[usePremiumStatus] No session found')
        setStatus({
          isPremium: false,
          productType: '',
          isLoading: false,
          error: 'No session found'
        })
        return
      }

      console.log('[usePremiumStatus] Session found, calling premium verification API')

      // Call the premium verification API
      const response = await fetch('/api/auth/verify-premium', {
        method: 'GET',
        credentials: 'include'
      })

      console.log('[usePremiumStatus] API response status:', response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error('[usePremiumStatus] API error:', errorData)
        throw new Error(errorData.error || 'Failed to verify premium status')
      }

      const data = (await response.json()) as PremiumVerificationResponse
      console.log('[usePremiumStatus] API response data:', data)

      setStatus({
        isPremium: data.isPremium,
        productType: data.productType,
        isLoading: false,
        error: null
      })

      console.log('[usePremiumStatus] Premium status set:', {
        isPremium: data.isPremium,
        productType: data.productType
      })
    } catch (error) {
      console.error('[usePremiumStatus] Error checking premium status:', error)
      setStatus({
        isPremium: false,
        productType: '',
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [supabase])

  const refreshPremiumStatus = useCallback(async (): Promise<void> => {
    await checkPremiumStatus()
  }, [checkPremiumStatus])

  useEffect(() => {
    void checkPremiumStatus()
  }, [checkPremiumStatus])

  return {
    ...status,
    refreshPremiumStatus
  }
} 