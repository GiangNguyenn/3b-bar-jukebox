import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import {
  handleApiError,
  determineErrorType
} from '@/shared/utils/errorHandling'
import { ErrorType } from '@/shared/types/recovery'
import { TOKEN_RECOVERY_CONFIG } from '@/shared/constants/recovery'
import { fetchPublicToken, PublicTokenError } from '@/shared/token/publicToken'

export function useTokenRecovery() {
  const params = useParams()
  const username = params?.username as string | undefined
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRecovering, setIsRecovering] = useState(false)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)

  const { addLog } = useConsoleLogsContext()

  const fetchToken = useCallback(
    async (attempt = 0): Promise<string | null> => {
      if (!username) {
        setError('Username is required')
        setLoading(false)
        return null
      }

      try {
        setLoading(true)
        setError(null)
        setIsRecovering(attempt > 0)

        if (attempt > 0) {
          addLog(
            'INFO',
            `Token recovery attempt ${attempt}/${TOKEN_RECOVERY_CONFIG.MAX_RETRY_ATTEMPTS}`,
            'useTokenRecovery'
          )
        }

        const tokenData = await fetchPublicToken(username)
        setToken(tokenData.access_token)
        setConsecutiveFailures(0)

        if (attempt > 0) {
          addLog('INFO', 'Token recovery successful', 'useTokenRecovery')
        }
        return tokenData.access_token
      } catch (err) {
        console.error('[useTokenRecovery] Error fetching token:', err)
        if (err instanceof PublicTokenError) {
          const errorType = determineErrorType(err.response)
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
              'useTokenRecovery'
            )
            await new Promise((resolve) => setTimeout(resolve, delay))
            return fetchToken(attempt + 1)
          }
          const appError = handleApiError(err.response, 'useTokenRecovery')
          setError(appError.message)
        } else {
          const errorMessage =
            err instanceof Error ? err.message : 'An error occurred'
          setError(errorMessage)
        }

        setConsecutiveFailures((prev) => prev + 1)
        if (attempt >= TOKEN_RECOVERY_CONFIG.MAX_RETRY_ATTEMPTS) {
          addLog(
            'ERROR',
            'Token recovery failed after max attempts',
            'useTokenRecovery'
          )
        }
        return null
      } finally {
        setLoading(false)
        setIsRecovering(false)
      }
    },
    [username, addLog]
  )

  // Automatically fetch the token when the component mounts or username changes
  useEffect(() => {
    void fetchToken()
  }, [fetchToken])

  const isJukeboxOffline =
    consecutiveFailures >= TOKEN_RECOVERY_CONFIG.OFFLINE_THRESHOLD

  return {
    token,
    loading,
    error,
    isRecovering,
    isJukeboxOffline,
    fetchToken
  }
}
