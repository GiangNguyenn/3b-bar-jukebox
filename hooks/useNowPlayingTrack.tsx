import { useEffect, useState, useRef } from 'react'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'

interface UseNowPlayingTrackProps {
  token?: string | null
  enabled?: boolean
}

export function useNowPlayingTrack({
  token,
  enabled = true
}: UseNowPlayingTrackProps = {}) {
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
            console.log('[useNowPlayingTrack] Token invalid')
            setData(null)
            return
          }
          throw new Error(
            `HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`
          )
        }

        // Handle 204 No Content (no currently playing track)
        if (fetchResponse.status === 204) {
          console.log('[useNowPlayingTrack] No currently playing track')
          setData(null)
          return
        }

        // Check if response has content before parsing JSON
        const responseText = await fetchResponse.text()
        if (!responseText.trim()) {
          console.log('[useNowPlayingTrack] Empty response body')
          setData(null)
          return
        }

        response = JSON.parse(responseText)
      } else {
        // Use authenticated user's token via sendApiRequest
        response = await sendApiRequest<SpotifyPlaybackState>({
          path,
          extraHeaders: {
            'Content-Type': 'application/json'
          }
        })
      }

      // Only log if the track has changed
      const currentTrackId = response?.item?.id
      if (currentTrackId !== lastTrackId.current) {
        console.log('[useNowPlayingTrack] Track changed:', {
          isPlaying: response?.is_playing,
          trackName: response?.item?.name,
          trackId: currentTrackId
        })
        lastTrackId.current = currentTrackId ?? null
      }

      setData(response)
    } catch (err) {
      console.error('[useNowPlayingTrack] Error:', err)

      // Handle authentication errors gracefully
      if (err instanceof Error && err.message.includes('401')) {
        console.log(
          '[useNowPlayingTrack] User not authenticated, skipping currently playing detection'
        )
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

    // Set up polling every 10 seconds
    intervalRef.current = setInterval(() => {
      void fetchCurrentlyPlaying()
    }, 10000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [token, enabled])

  return {
    data,
    error,
    isLoading,
    refetch: fetchCurrentlyPlaying
  }
}

// Default export for backward compatibility
export default useNowPlayingTrack
