import { useState, useEffect, useRef } from 'react'
import type {
  TokenResponse,
  TokenErrorResponse,
  OfflineErrorCode
} from '@/shared/types/token'
import { OFFLINE_ERROR_CODES } from '@/shared/constants/token'
import {
  safeParseTokenResponse,
  safeParseTokenErrorResponse
} from '@/shared/validations/tokenSchemas'

export interface UserTokenHookResult {
  token: string | null
  loading: boolean
  error: string | null
  isJukeboxOffline: boolean
}

export function useUserToken(): UserTokenHookResult {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isJukeboxOffline, setIsJukeboxOffline] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const fetchToken = async (): Promise<void> => {
      try {
        setLoading(true)
        setError(null)
        setIsJukeboxOffline(false)

        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          signal: abortController.signal
        })

        if (!response.ok) {
          try {
            const errorDataRaw = await response.json()
            const parseResult = safeParseTokenErrorResponse(errorDataRaw)

            if (parseResult.success) {
              const errorData = parseResult.data
              const errorMessage =
                errorData.error || 'Failed to retrieve Spotify token'

              // Determine if jukebox is offline based on error codes
              const isOffline =
                (errorData.code &&
                  OFFLINE_ERROR_CODES.includes(
                    errorData.code as OfflineErrorCode
                  )) ||
                response.status >= 500

              setError(errorMessage)
              setIsJukeboxOffline(isOffline)
              setToken(null)
            } else {
              // Invalid error response format
              setError('Invalid error response from server')
              setIsJukeboxOffline(response.status >= 500)
              setToken(null)
            }
          } catch (parseError) {
            // Failed to parse error response as JSON
            setError('Invalid error response from server')
            setIsJukeboxOffline(response.status >= 500)
            setToken(null)
          }
          // Don't set loading here - outer finally block will handle it
          return
        }

        try {
          const dataRaw = await response.json()
          const parseResult = safeParseTokenResponse(dataRaw)

          if (parseResult.success) {
            const data = parseResult.data
            setToken(data.access_token)
            setError(null)
            setIsJukeboxOffline(false)
          } else {
            setError('Invalid token response format')
            setIsJukeboxOffline(true)
            setToken(null)
          }
        } catch (parseError) {
          // Failed to parse response as JSON
          setError('Invalid token response format')
          setIsJukeboxOffline(true)
          setToken(null)
        }
      } catch (err) {
        // Handle AbortError silently (component unmounted)
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }

        // Network or system errors indicate jukebox is offline
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to retrieve token'
        setError(errorMessage)
        setIsJukeboxOffline(true)
        setToken(null)
      } finally {
        setLoading(false)
      }
    }

    void fetchToken()

    return () => {
      abortController.abort()
    }
  }, [])

  return {
    token,
    loading,
    error,
    isJukeboxOffline
  }
}
