import { useState, useCallback } from 'react'

interface UseLoadingStateOptions {
  initialLoading?: boolean
  loadingMessage?: string
}

export function useLoadingState(options: UseLoadingStateOptions = {}) {
  const [isLoading, setIsLoading] = useState(options.initialLoading ?? false)
  const [loadingMessage, setLoadingMessage] = useState(options.loadingMessage)

  const startLoading = useCallback((message?: string) => {
    setIsLoading(true)
    if (message) setLoadingMessage(message)
  }, [])

  const stopLoading = useCallback(() => {
    setIsLoading(false)
    setLoadingMessage(undefined)
  }, [])

  const withLoading = useCallback(
    async <T>(asyncFn: () => Promise<T>, message?: string): Promise<T> => {
      try {
        startLoading(message)
        return await asyncFn()
      } finally {
        stopLoading()
      }
    },
    [startLoading, stopLoading]
  )

  return {
    isLoading,
    loadingMessage,
    startLoading,
    stopLoading,
    withLoading
  }
}
