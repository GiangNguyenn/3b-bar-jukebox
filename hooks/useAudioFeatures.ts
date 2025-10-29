import { useEffect, useState, useRef } from 'react'
import { SpotifyAudioFeatures } from '@/shared/types/spotify'

export function useAudioFeatures(trackId: string | null) {
  const [features, setFeatures] = useState<SpotifyAudioFeatures | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!trackId) {
      setFeatures(null)
      setError(null)
      return
    }

    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new AbortController for this request
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    async function fetchFeatures() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/audio-features/${trackId}`, {
          signal: abortController.signal
        })

        if (!response.ok) {
          throw new Error('Failed to fetch audio features')
        }

        const data = (await response.json()) as SpotifyAudioFeatures
        setFeatures(data)
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Unknown error')
        setFeatures(null)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchFeatures()

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [trackId])

  return { features, isLoading, error }
}
