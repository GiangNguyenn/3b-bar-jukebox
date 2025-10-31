import { useState, useEffect } from 'react'

export interface UserTokenHookResult {
  token: string | null
  loading: boolean
  error: string | null
  isJukeboxOffline: boolean
}

interface TokenResponse {
  access_token: string
  token_type?: string
  scope?: string
  expires_in: number
  refresh_token?: string
}

interface ErrorResponse {
  error: string
  code?: string
  status?: number
}

export function useUserToken(): UserTokenHookResult {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isJukeboxOffline, setIsJukeboxOffline] = useState(false)

  useEffect(() => {
    const fetchToken = async (): Promise<void> => {
      try {
        setLoading(true)
        setError(null)
        setIsJukeboxOffline(false)

        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include'
        })

        if (!response.ok) {
          const errorData = (await response.json()) as ErrorResponse
          const errorMessage =
            errorData.error || 'Failed to retrieve Spotify token'

          // Determine if jukebox is offline based on error codes
          const offlineErrorCodes = [
            'TOKEN_REFRESH_ERROR',
            'PROFILE_UPDATE_ERROR',
            'INTERNAL_ERROR'
          ]
          const isOffline =
            offlineErrorCodes.includes(errorData.code ?? '') ||
            response.status >= 500

          setError(errorMessage)
          setIsJukeboxOffline(isOffline)
          setToken(null)
          setLoading(false)
          return
        }

        const data = (await response.json()) as TokenResponse
        if (data?.access_token) {
          setToken(data.access_token)
          setError(null)
          setIsJukeboxOffline(false)
        } else {
          setError('Invalid token response')
          setIsJukeboxOffline(true)
          setToken(null)
        }
      } catch (err) {
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
  }, [])

  return {
    token,
    loading,
    error,
    isJukeboxOffline
  }
}
