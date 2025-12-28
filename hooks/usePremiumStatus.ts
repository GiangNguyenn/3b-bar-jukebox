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
