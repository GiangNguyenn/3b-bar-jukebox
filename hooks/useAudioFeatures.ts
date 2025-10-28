import { useEffect, useState } from 'react'
import { SpotifyAudioFeatures } from '@/shared/types/spotify'

export function useAudioFeatures(trackId: string | null) {
  const [features, setFeatures] = useState<SpotifyAudioFeatures | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!trackId) {
      setFeatures(null)
      return
    }

    async function fetchFeatures() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/audio-features/${trackId}`)

        if (!response.ok) {
          throw new Error('Failed to fetch audio features')
        }

        const data = (await response.json()) as SpotifyAudioFeatures
        setFeatures(data)
      } catch (err) {
        console.error('Error fetching audio features:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setFeatures(null)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchFeatures()
  }, [trackId])

  return { features, isLoading, error }
}
