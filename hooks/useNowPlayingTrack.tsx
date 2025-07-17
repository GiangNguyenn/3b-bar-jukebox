import { useEffect, useState, useRef } from 'react'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'

interface UseNowPlayingTrackOptions {
  token?: string | null
  enabled?: boolean
  refetchInterval?: number | null
}

export function useNowPlayingTrack({
  token,
  enabled = true,
  refetchInterval = 30000
}: UseNowPlayingTrackOptions = {}) {
  const [data, setData] = useState<SpotifyPlaybackState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastTrackId = useRef<string | null>(null)

  const fetchCurrentlyPlaying = async () => {
    if (!enabled) {
      setData(null)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const queryParams = new URLSearchParams({
        market: 'from_token',
        additional_types: 'track,episode'
      })
      const path = `me/player/currently-playing?${queryParams.toString()}`

      let response: SpotifyPlaybackState

      if (token) {
        // Use provided token
        const fetchResponse = await fetch(
          `https://api.spotify.com/v1/${path}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        )

        if (!fetchResponse.ok) {
          if (fetchResponse.status === 401) {
            setData(null)
            return
          }
          throw new Error(
            `HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`
          )
        }

        // Handle 204 No Content (no currently playing track)
        if (fetchResponse.status === 204) {
          setData(null)
          return
        }

        // Check if response has content before parsing JSON
        const responseText = await fetchResponse.text()
        if (!responseText.trim()) {
          setData(null)
          return
        }

        response = JSON.parse(responseText)
      } else {
        // Use our server-side API endpoint that handles admin credentials
        const apiResponse = await fetch('/api/now-playing')

        if (!apiResponse.ok) {
          if (apiResponse.status === 204) {
            // No currently playing track
            setData(null)
            return
          }
          throw new Error(
            `HTTP ${apiResponse.status}: ${apiResponse.statusText}`
          )
        }

        // Handle 204 No Content (no currently playing track)
        if (apiResponse.status === 204) {
          setData(null)
          return
        }

        // Check if response has content before parsing JSON
        const responseText = await apiResponse.text()
        if (!responseText.trim()) {
          setData(null)
          return
        }

        response = JSON.parse(responseText)
      }

      // Update last track ID
      const currentTrackId = response?.item?.id
      lastTrackId.current = currentTrackId ?? null

      setData(response)
    } catch (err) {
      console.error('[useNowPlayingTrack] Error:', err)

      // Handle authentication errors gracefully
      if (err instanceof Error && err.message.includes('401')) {
        setData(null)
        return
      }

      setError(err instanceof Error ? err.message : 'An error occurred')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (!enabled) {
      setData(null)
      return
    }

    // Initial fetch
    void fetchCurrentlyPlaying()

    if (refetchInterval && refetchInterval > 0) {
      intervalRef.current = setInterval(() => {
        void fetchCurrentlyPlaying()
      }, refetchInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [token, enabled, refetchInterval])

  return {
    data,
    error,
    isLoading,
    refetch: fetchCurrentlyPlaying
  }
}

// Default export for backward compatibility
export default useNowPlayingTrack
