import { useEffect, useState, useRef, useCallback } from 'react'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

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
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchCurrentlyPlaying = useCallback(async () => {
    if (!enabled) {
      setData(null)
      return
    }

    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new AbortController for this request
    const abortController = new AbortController()
    abortControllerRef.current = abortController

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
            },
            signal: abortController.signal
          }
        )

        // Handle 204 No Content (no currently playing track)
        if (fetchResponse.status === 204) {
          setData(null)
          return
        }

        if (!fetchResponse.ok) {
          if (fetchResponse.status === 401) {
            // Token might be expired, but we can't refresh it here since we're using a direct token
            // Just set data to null and let the caller handle token refresh
            setData(null)
            return
          }
          throw new Error(
            `HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`
          )
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
        const apiResponse = await fetch('/api/now-playing', {
          signal: abortController.signal
        })

        // Handle 204 No Content (no currently playing track)
        if (apiResponse.status === 204) {
          setData(null)
          return
        }

        if (!apiResponse.ok) {
          throw new Error(
            `HTTP ${apiResponse.status}: ${apiResponse.statusText}`
          )
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
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      // Handle authentication errors gracefully
      if (err instanceof Error && err.message.includes('401')) {
        // Token might be expired, but we can't refresh it here since we're using a direct token
        // Just set data to null and let the caller handle token refresh
        setData(null)
        return
      }

      setError(err instanceof Error ? err.message : 'An error occurred')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [token, enabled])

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Cleanup any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchCurrentlyPlaying, refetchInterval])

  return {
    data,
    error,
    isLoading,
    refetch: fetchCurrentlyPlaying
  }
}

// Default export for backward compatibility
export default useNowPlayingTrack
