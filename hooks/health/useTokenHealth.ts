import { useState, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'

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
    const checkTokenStatus = async (): Promise<void> => {
      try {
        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-cache'
        })

        if (!response.ok) {
          addLog(
            'ERROR',
            `Token validation failed: ${response.status} ${response.statusText}`,
            'TokenHealth'
          )
          setTokenStatus({ status: 'error', expiringSoon: false })
          return
        }

        const data = await response.json()
        const expiresSoonThreshold = 300 // 5 minutes
        const criticalThreshold = 60 // 1 minute

        if (data.expiresIn && data.expiresIn < criticalThreshold) {
          setTokenStatus({ status: 'valid', expiringSoon: true })
          addLog(
            'ERROR',
            `Token expiring critically soon: ${data.expiresIn}s remaining`,
            'TokenHealth'
          )
        } else if (data.expiresIn && data.expiresIn < expiresSoonThreshold) {
          setTokenStatus({ status: 'valid', expiringSoon: true })
          addLog(
            'WARN',
            `Token expiring soon: ${data.expiresIn}s remaining`,
            'TokenHealth'
          )
        } else {
          setTokenStatus({ status: 'valid', expiringSoon: false })
        }
      } catch (error) {
        addLog(
          'ERROR',
          'Token validation error',
          'TokenHealth',
          error instanceof Error ? error : undefined
        )
        setTokenStatus({ status: 'error', expiringSoon: false })
      }
    }

    // Check token status immediately and then every 30 seconds
    void checkTokenStatus()
    const interval = setInterval(checkTokenStatus, 30000)

    return () => clearInterval(interval)
  }, [addLog])

  return tokenStatus
}
