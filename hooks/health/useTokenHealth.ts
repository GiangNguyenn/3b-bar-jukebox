import { useState, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import type { TokenHealthResponse } from '@/shared/types/token'
import {
  TOKEN_EXPIRY_THRESHOLDS,
  TOKEN_HEALTH_CHECK_INTERVAL
} from '@/shared/constants/token'
import { safeParseTokenHealthResponse } from '@/shared/validations/tokenSchemas'

interface TokenHealthStatus {
  status: 'valid' | 'expired' | 'error' | 'unknown'
  expiringSoon: boolean
}

export function useTokenHealth(): TokenHealthStatus {
  const [tokenStatus, setTokenStatus] = useState<TokenHealthStatus>({
    status: 'unknown',
    expiringSoon: false
  })

  const { addLog } = useConsoleLogsContext()

  useEffect(() => {
    const abortController = new AbortController()

    // Helper to safely update state only if component is still mounted
    const safeUpdateStatus = (
      newStatus: TokenHealthStatus,
      logLevel?: 'ERROR' | 'WARN',
      logMessage?: string
    ): void => {
      if (!abortController.signal.aborted) {
        setTokenStatus(newStatus)
        if (logLevel && logMessage) {
          addLog(logLevel, logMessage, 'TokenHealth')
        }
      }
    }

    const checkTokenStatus = async (): Promise<void> => {
      // Don't proceed if component has unmounted
      if (abortController.signal.aborted) {
        return
      }

      try {
        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-cache',
          signal: abortController.signal
        })

        if (!response.ok) {
          safeUpdateStatus(
            { status: 'error', expiringSoon: false },
            'ERROR',
            `Token validation failed: ${response.status} ${response.statusText}`
          )
          return
        }

        try {
          const dataRaw = await response.json()
          const parseResult = safeParseTokenHealthResponse(dataRaw)

          if (!parseResult.success) {
            safeUpdateStatus(
              { status: 'error', expiringSoon: false },
              'ERROR',
              'Invalid token health response format'
            )
            return
          }

          const data: TokenHealthResponse = parseResult.data

          // Check expiresIn or expires_in (API may return either)
          const expiresIn = data.expiresIn ?? data.expires_in ?? undefined

          if (expiresIn === undefined) {
            // No expiry info, assume valid
            safeUpdateStatus({ status: 'valid', expiringSoon: false })
            return
          }

          // Validate expiresIn is a number
          if (typeof expiresIn !== 'number' || expiresIn < 0) {
            safeUpdateStatus(
              { status: 'error', expiringSoon: false },
              'ERROR',
              `Invalid expiresIn value: ${expiresIn}`
            )
            return
          }

          if (expiresIn < TOKEN_EXPIRY_THRESHOLDS.CRITICAL) {
            safeUpdateStatus(
              { status: 'valid', expiringSoon: true },
              'ERROR',
              `Token expiring critically soon: ${expiresIn}s remaining`
            )
          } else if (expiresIn < TOKEN_EXPIRY_THRESHOLDS.WARNING) {
            safeUpdateStatus(
              { status: 'valid', expiringSoon: true },
              'WARN',
              `Token expiring soon: ${expiresIn}s remaining`
            )
          } else {
            safeUpdateStatus({ status: 'valid', expiringSoon: false })
          }
        } catch (parseError) {
          safeUpdateStatus(
            { status: 'error', expiringSoon: false },
            'ERROR',
            'Failed to parse token health response'
          )
          if (!abortController.signal.aborted) {
            addLog(
              'ERROR',
              'Failed to parse token health response',
              'TokenHealth',
              parseError instanceof Error ? parseError : undefined
            )
          }
        }
      } catch (error) {
        // Handle AbortError silently (component unmounted)
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }

        safeUpdateStatus(
          { status: 'error', expiringSoon: false },
          'ERROR',
          'Token validation error'
        )
        if (!abortController.signal.aborted && error instanceof Error) {
          addLog('ERROR', 'Token validation error', 'TokenHealth', error)
        }
      }
    }

    // Check token status immediately and then every 30 seconds
    void checkTokenStatus()
    const interval = setInterval(() => {
      void checkTokenStatus()
    }, TOKEN_HEALTH_CHECK_INTERVAL)

    return () => {
      abortController.abort()
      clearInterval(interval)
    }
  }, [addLog])

  return tokenStatus
}
