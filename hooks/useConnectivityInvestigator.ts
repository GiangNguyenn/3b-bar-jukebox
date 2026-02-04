'use client'

import { useState, useCallback, useEffect } from 'react'
import { connectivityInvestigator } from '@/shared/utils/connectivityInvestigator'
import type {
  ConnectivityInvestigation,
  FailedRequestInfo,
  RequestContext
} from '@/shared/types/connectivity'

/**
 * Hook for managing connectivity investigations
 * Provides access to investigation state and control functions
 */
export function useConnectivityInvestigator() {
  const [investigation, setInvestigation] =
    useState<ConnectivityInvestigation | null>(null)

  // Refresh investigation state
  const refresh = useCallback(() => {
    const current = connectivityInvestigator.getInvestigation()
    setInvestigation(current)
  }, [])

  // Trigger an investigation (runs in background)
  const investigate = useCallback(
    (error: unknown, context: RequestContext) => {
      // Trigger investigation asynchronously
      void connectivityInvestigator.investigate(error, context).then(() => {
        // Refresh state after investigation completes
        refresh()
      })

      // Also record the failure immediately
      connectivityInvestigator.recordFailure(error, context)
      refresh()
    },
    [refresh]
  )

  // Get recent failed requests
  const recentFailures: FailedRequestInfo[] =
    investigation?.recentFailures || []

  // Clear investigation history
  const clearHistory = useCallback(() => {
    connectivityInvestigator.clearHistory()
    refresh()
  }, [refresh])

  // Auto-refresh investigation state periodically
  useEffect(() => {
    // Initial load
    refresh()

    // Refresh every 5 seconds to pick up background investigations
    const interval = setInterval(refresh, 5000)

    return () => clearInterval(interval)
  }, [refresh])

  return {
    investigate,
    investigation,
    recentFailures,
    clearHistory
  }
}
