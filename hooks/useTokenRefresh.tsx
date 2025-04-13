import { useState, useEffect, useCallback } from 'react'
import { TokenResponse, TokenInfo } from '@/shared/utils/token'

const TOKEN_CHECK_INTERVAL = 30000 // 30 seconds
const TOKEN_REFRESH_THRESHOLD = 300000 // 5 minutes

export const useTokenRefresh = () => {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo>({
    lastRefresh: 0,
    expiresIn: 0,
    scope: '',
    type: '',
    lastActualRefresh: 0
  })
  const [tokenStatus, setTokenStatus] = useState<
    'valid' | 'expired' | 'error' | 'unknown'
  >('unknown')

  const checkToken = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/token-info')
      const data = (await response.json()) as TokenResponse

      if (!data.access_token || !data.expires_in) {
        console.error('[Token] Invalid token data:', data)
        setTokenStatus('error')
        return
      }

      const now = Date.now()
      const expirationTime = now + data.expires_in * 1000
      const remainingTime = Math.max(0, expirationTime - now)

      setTokenInfo((prev) => ({
        lastRefresh: now,
        expiresIn: data.expires_in,
        scope: data.scope,
        type: data.token_type,
        lastActualRefresh: now
      }))

      if (remainingTime < TOKEN_REFRESH_THRESHOLD) {
        setTokenStatus('expired')
      } else {
        setTokenStatus('valid')
      }
    } catch (error) {
      console.error('[Token] Failed to fetch token info:', error)
      setTokenStatus('error')
    }
  }, [])

  useEffect(() => {
    // Initial check
    void checkToken()

    // Set up interval
    const interval = setInterval(() => {
      void checkToken()
    }, TOKEN_CHECK_INTERVAL)

    return () => {
      clearInterval(interval)
    }
  }, [checkToken])

  return { tokenInfo, tokenStatus, setTokenInfo }
}
