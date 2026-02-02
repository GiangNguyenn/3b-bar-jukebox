import { useEffect, useRef } from 'react'
import { tokenManager } from '@/shared/token/tokenManager'
import { TOKEN_REFRESH_CHECK_INTERVAL } from '@/shared/constants/token'
import type { PlayerStatus } from './useSpotifyPlayer'

export interface UseAdminTokenManagementParams {
  tokenHealthStatus: 'valid' | 'error' | 'unknown' | 'expired'
  isLoading: boolean
  isReady: boolean
  playerStatus: PlayerStatus
  handleTokenError: () => Promise<void>
  addLog: (
    level: 'WARN' | 'ERROR' | 'INFO' | 'LOG',
    message: string,
    context?: string,
    error?: Error
  ) => void
}

/**
 * Hook for managing token health and proactive refresh in admin pages
 * Monitors token health status and automatically refreshes tokens when needed
 */
export function useAdminTokenManagement(
  params: UseAdminTokenManagementParams
): void {
  const {
    tokenHealthStatus,
    isLoading,
    isReady,
    playerStatus,
    handleTokenError,
    addLog
  } = params

  // Use ref instead of isMounted pattern for better React practices
  const isMountedRef = useRef(true)

  // Handle token errors when health status indicates an error
  // Allow recovery even if player is not ready (reconnecting/error states need recovery)
  useEffect(() => {
    const shouldAttemptRecovery =
      tokenHealthStatus === 'error' &&
      !isLoading &&
      (isReady || playerStatus === 'reconnecting' || playerStatus === 'error')

    if (shouldAttemptRecovery) {
      void handleTokenError()
    }
  }, [tokenHealthStatus, isLoading, isReady, playerStatus, handleTokenError])

  // Proactive token refresh
  useEffect(() => {
    if (!isReady) return

    isMountedRef.current = true

    const runRefresh = async (): Promise<void> => {
      if (!isMountedRef.current) return

      try {
        await tokenManager.refreshIfNeeded()
      } catch (error: unknown) {
        if (isMountedRef.current) {
          addLog(
            'ERROR',
            'Proactive token refresh failed',
            'AdminPage',
            error instanceof Error ? error : undefined
          )
        }
      }
    }

    // Run immediately
    void runRefresh()

    // Then run at configured interval
    const interval = setInterval(() => {
      void runRefresh()
    }, TOKEN_REFRESH_CHECK_INTERVAL)

    return (): void => {
      isMountedRef.current = false
      clearInterval(interval)
    }
  }, [isReady, addLog])
}
