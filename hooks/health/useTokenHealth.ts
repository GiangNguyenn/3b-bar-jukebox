import { useState, useEffect, useRef } from 'react'
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
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const abortController = new AbortController()
    abortControllerRef.current = abortController

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
          if (!abortController.signal.aborted) {
            addLog(
              'ERROR',
              `Token validation failed: ${response.status} ${response.statusText}`,
              'TokenHealth'
            )
            setTokenStatus({ status: 'error', expiringSoon: false })
          }
          return
        }

        try {
          const dataRaw = await response.json()
          const parseResult = safeParseTokenHealthResponse(dataRaw)

          if (!parseResult.success) {
            if (!abortController.signal.aborted) {
              addLog(
                'ERROR',
                'Invalid token health response format',
                'TokenHealth'
              )
              setTokenStatus({ status: 'error', expiringSoon: false })
            }
            return
          }

          const data: TokenHealthResponse = parseResult.data

          // Check expiresIn or expires_in (API may return either)
          const expiresIn = data.expiresIn ?? data.expires_in ?? undefined

          if (expiresIn === undefined) {
            // No expiry info, assume valid
            if (!abortController.signal.aborted) {
              setTokenStatus({ status: 'valid', expiringSoon: false })
            }
            return
          }

          // Validate expiresIn is a number
          if (typeof expiresIn !== 'number' || expiresIn < 0) {
            if (!abortController.signal.aborted) {
              addLog(
                'ERROR',
                `Invalid expiresIn value: ${expiresIn}`,
                'TokenHealth'
              )
              setTokenStatus({ status: 'error', expiringSoon: false })
            }
            return
          }

          if (expiresIn < TOKEN_EXPIRY_THRESHOLDS.CRITICAL) {
            if (!abortController.signal.aborted) {
              setTokenStatus({ status: 'valid', expiringSoon: true })
              addLog(
                'ERROR',
                `Token expiring critically soon: ${expiresIn}s remaining`,
                'TokenHealth'
              )
            }
          } else if (expiresIn < TOKEN_EXPIRY_THRESHOLDS.WARNING) {
            if (!abortController.signal.aborted) {
              setTokenStatus({ status: 'valid', expiringSoon: true })
              addLog(
                'WARN',
                `Token expiring soon: ${expiresIn}s remaining`,
                'TokenHealth'
              )
            }
          } else {
            if (!abortController.signal.aborted) {
              setTokenStatus({ status: 'valid', expiringSoon: false })
            }
          }
        } catch (parseError) {
          if (!abortController.signal.aborted) {
            addLog(
              'ERROR',
              'Failed to parse token health response',
              'TokenHealth',
              parseError instanceof Error ? parseError : undefined
            )
            setTokenStatus({ status: 'error', expiringSoon: false })
          }
        }
      } catch (error) {
        // Handle AbortError silently (component unmounted)
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }

        if (!abortController.signal.aborted) {
          addLog(
            'ERROR',
            'Token validation error',
            'TokenHealth',
            error instanceof Error ? error : undefined
          )
          setTokenStatus({ status: 'error', expiringSoon: false })
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
