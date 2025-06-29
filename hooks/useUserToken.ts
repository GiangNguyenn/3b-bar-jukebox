import { useEffect, useState } from 'react'
import { useTokenRecovery } from './recovery'

export function useUserToken() {
  const {
    token: initialToken,
    loading: initialLoading,
    error: initialError,
    isRecovering: initialIsRecovering,
    isJukeboxOffline,
    fetchToken
  } = useTokenRecovery()

  const [token, setToken] = useState<string | null>(initialToken)
  const [loading, setLoading] = useState(initialLoading)
  const [error, setError] = useState<string | null>(initialError)
  const [isRecovering, setIsRecovering] = useState(initialIsRecovering)

  useEffect(() => {
    if (initialToken) {
      setToken(initialToken)
    }
  }, [initialToken])

  useEffect(() => {
    setToken(initialToken)
  }, [initialToken])

  useEffect(() => {
    setLoading(initialLoading)
  }, [initialLoading])

  useEffect(() => {
    setError(initialError)
  }, [initialError])

  useEffect(() => {
    setIsRecovering(initialIsRecovering)
  }, [initialIsRecovering])

  return {
    token,
    loading,
    error,
    isRecovering,
    isJukeboxOffline,
    fetchToken
  }
}
