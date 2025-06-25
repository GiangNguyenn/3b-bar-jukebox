import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import {
  handleApiError,
  determineErrorType
} from '@/shared/utils/errorHandling'
import { ErrorType } from '@/shared/types/recovery'
import { TOKEN_RECOVERY_CONFIG } from '@/shared/constants/recovery'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

export function useUserToken() {
  const params = useParams()
  const username = params?.username as string | undefined
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [isRecovering, setIsRecovering] = useState(false)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)

  const { addLog } = useConsoleLogsContext()

  const fetchTokenWithRetry = useCallback(
    async (attempt = 0): Promise<void> => {
      if (!username) {
        setError('Username is required')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        setIsRecovering(attempt > 0)

        if (attempt > 0) {
          addLog(
            'INFO',
            `Token recovery attempt ${attempt}/${TOKEN_RECOVERY_CONFIG.MAX_RETRY_ATTEMPTS}`,
            'useUserToken'
          )
        }

        const response = await fetch(
          `/api/token/${encodeURIComponent(username)}`
        )

        if (!response.ok) {
          const errorData = (await response.json()) as ErrorResponse

          // Reuse existing error classification
          const errorType = determineErrorType(errorData)

          // Check if this is a recoverable error and we haven't exceeded max attempts
          if (
            errorType === ErrorType.AUTH &&
            attempt < TOKEN_RECOVERY_CONFIG.MAX_RETRY_ATTEMPTS
          ) {
            const delay =
              TOKEN_RECOVERY_CONFIG.RETRY_DELAYS[attempt] ||
              TOKEN_RECOVERY_CONFIG.RETRY_DELAYS[
                TOKEN_RECOVERY_CONFIG.RETRY_DELAYS.length - 1
              ]

            addLog(
              'WARN',
              `Token error, retrying in ${delay}ms...`,
              'useUserToken'
            )

            setTimeout(() => {
              setRecoveryAttempts(attempt + 1)
              void fetchTokenWithRetry(attempt + 1)
            }, delay)
            return
          }

          // If we've exhausted retries or it's not a recoverable error
          setConsecutiveFailures((prev) => prev + 1)
          const appError = handleApiError(errorData, 'useUserToken')
          throw new Error(appError.message)
        }

        const tokenData = (await response.json()) as TokenResponse
        setToken(tokenData.access_token)
        setRecoveryAttempts(0)
        setConsecutiveFailures(0) // Reset failures on success

        if (attempt > 0) {
          addLog('INFO', 'Token recovery successful', 'useUserToken')
        }
      } catch (err) {
        console.error('[useUserToken] Error fetching token:', err)
        const errorMessage =
          err instanceof Error ? err.message : 'An error occurred'
        setError(errorMessage)

        if (attempt >= TOKEN_RECOVERY_CONFIG.MAX_RETRY_ATTEMPTS) {
          setConsecutiveFailures((prev) => prev + 1)
          addLog(
            'ERROR',
            'Token recovery failed after max attempts',
            'useUserToken'
          )
        }
      } finally {
        setLoading(false)
        setIsRecovering(false)
      }
    },
    [username, addLog]
  )

  useEffect(() => {
    void fetchTokenWithRetry()
  }, [fetchTokenWithRetry])

  // Simple offline state based on consecutive failures
  const isJukeboxOffline =
    consecutiveFailures >= TOKEN_RECOVERY_CONFIG.OFFLINE_THRESHOLD

  return {
    token,
    loading,
    error,
    isRecovering,
    recoveryAttempts,
    isJukeboxOffline
  }
}
