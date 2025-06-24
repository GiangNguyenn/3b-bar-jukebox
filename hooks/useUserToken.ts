import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

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

  useEffect(() => {
    if (!username) {
      setError('Username is required')
      setLoading(false)
      return
    }

    const fetchToken = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(
          `/api/token/${encodeURIComponent(username)}`
        )

        if (!response.ok) {
          const errorData = (await response.json()) as ErrorResponse
          throw new Error(errorData.error || 'Failed to fetch token')
        }

        const tokenData = (await response.json()) as TokenResponse
        setToken(tokenData.access_token)
      } catch (err) {
        console.error('[useUserToken] Error fetching token:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    void fetchToken()
  }, [username])

  return { token, loading, error }
}
