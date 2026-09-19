import { useCallback } from 'react'
import { SpotifyUserProfile } from '@/shared/types/spotify'

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
  const refreshPremiumStatus = useCallback(async (): Promise<void> => {
    // No-op
  }, [])

  const forceRefreshPremiumStatus = useCallback(async (): Promise<void> => {
    // No-op
  }, [])

  return {
    isPremium: true,
    productType: 'premium',
    isLoading: false,
    error: null,
    needsReauth: false,
    refreshPremiumStatus,
    forceRefreshPremiumStatus
  }
}
