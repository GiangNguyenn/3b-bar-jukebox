import { useState } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import type { TokenHealthResponse } from '@/shared/types/token'
import {
  TOKEN_EXPIRY_THRESHOLDS,
  TOKEN_HEALTH_CHECK_INTERVAL
} from '@/shared/constants/token'
import { safeParseTokenHealthResponse } from '@/shared/validations/tokenSchemas'
import {
  useHealthAbortController,
  useSafeStateUpdate
} from './utils/useSafeStateUpdate'
import { useHealthInterval } from './utils/useHealthInterval'
import { handleHealthError, isAbortError } from './utils/errorHandling'

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
  const { signal, isAborted } = useHealthAbortController()
  const safeUpdateStatus = useSafeStateUpdate(signal, setTokenStatus)

  const checkTokenStatus = async (): Promise<void> => {
    // Don't proceed if component has unmounted
    if (isAborted()) {
      return
    }

    try {
      const response = await fetch('/api/token', {
        method: 'GET',
        cache: 'no-cache',
        signal
      })

      if (!response.ok) {
        safeUpdateStatus({
          status: 'error',
          expiringSoon: false
        })
        if (!isAborted()) {
          addLog(
            'ERROR',
            `Token validation failed: ${response.status} ${response.statusText}`,
            'TokenHealth'
          )
        }
        return
      }

      try {
        const dataRaw = await response.json()
        const parseResult = safeParseTokenHealthResponse(dataRaw)

        if (!parseResult.success) {
          safeUpdateStatus({
            status: 'error',
            expiringSoon: false
          })
          if (!isAborted()) {
            addLog(
              'ERROR',
              'Invalid token health response format',
              'TokenHealth'
            )
          }
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
          safeUpdateStatus({
            status: 'error',
            expiringSoon: false
          })
          if (!isAborted()) {
            addLog(
              'ERROR',
              `Invalid expiresIn value: ${expiresIn}`,
              'TokenHealth'
            )
          }
          return
        }

        if (expiresIn < TOKEN_EXPIRY_THRESHOLDS.CRITICAL) {
          safeUpdateStatus({
            status: 'valid',
            expiringSoon: true
          })
          if (!isAborted()) {
            addLog(
              'ERROR',
              `Token expiring critically soon: ${expiresIn}s remaining`,
              'TokenHealth'
            )
          }
        } else if (expiresIn < TOKEN_EXPIRY_THRESHOLDS.WARNING) {
          safeUpdateStatus({
            status: 'valid',
            expiringSoon: true
          })
          if (!isAborted()) {
            addLog(
              'WARN',
              `Token expiring soon: ${expiresIn}s remaining`,
              'TokenHealth'
            )
          }
        } else {
          safeUpdateStatus({ status: 'valid', expiringSoon: false })
        }
      } catch (parseError) {
        safeUpdateStatus({
          status: 'error',
          expiringSoon: false
        })
        handleHealthError(
          parseError,
          addLog,
          'TokenHealth',
          'Failed to parse token health response'
        )
      }
    } catch (error) {
      // Handle AbortError silently (component unmounted)
      if (isAbortError(error)) {
        return
      }

      safeUpdateStatus({
        status: 'error',
        expiringSoon: false
      })
      handleHealthError(error, addLog, 'TokenHealth', 'Token validation error')
    }
  }

  useHealthInterval(checkTokenStatus, {
    interval: TOKEN_HEALTH_CHECK_INTERVAL,
    enabled: true
  })

  return tokenStatus
}
