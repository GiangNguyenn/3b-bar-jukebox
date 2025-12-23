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
  refetchInterval = 12000 // 12 seconds - balanced for game responsiveness while reducing API calls
}: UseNowPlayingTrackOptions = {}) {
  const [data, setData] = useState<SpotifyPlaybackState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastTrackId = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const backoffUntilRef = useRef<number>(0)

  const fetchCurrentlyPlaying = useCallback(async () => {
    if (!enabled) {
      setData(null)
      return
    }

    // Check if we are in a backoff period (e.g. due to 429s)
    if (Date.now() < backoffUntilRef.current) {
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

        // Handle 429 Too Many Requests
        if (fetchResponse.status === 429) {
          const retryAfterHeader = fetchResponse.headers.get('Retry-After')
          const retryAfterSeconds = retryAfterHeader
            ? parseInt(retryAfterHeader, 10)
            : 5 // Default to 5 seconds if header missing

          // Set backoff timestamp
          backoffUntilRef.current = Date.now() + retryAfterSeconds * 1000

          setError(`Rate limited. Retrying after ${retryAfterSeconds}s`)
          // Don't clear data - keep showing last known track
          return
        }

        // Handle 204 No Content (no currently playing track)
        if (fetchResponse.status === 204) {
          setData(null)
          return
        }

        // Read response body once (can only be read once)
        const responseText = await fetchResponse.text()

        if (!fetchResponse.ok) {
          // For authentication errors (401/403), clear data
          if (fetchResponse.status === 401 || fetchResponse.status === 403) {
            // Token might be expired, but we can't refresh it here since we're using a direct token
            // Just set data to null and let the caller handle token refresh
            setData(null)
            return
          }

          // For other errors, preserve last known state (don't clear data)
          // This prevents UI from showing "No track" when there's a temporary API issue
          setError(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`)
          // Don't clear data - keep showing last known track
          return
        }

        // Check if response has content before parsing JSON
        if (!responseText.trim()) {
          setData(null)
          return
        }

        let parsedResponse
        try {
          parsedResponse = JSON.parse(responseText)
        } catch (parseError) {
          // Failed to parse JSON - preserve last known state
          setError('Failed to parse response')
          // Don't clear data - keep showing last known track
          return
        }

        response = parsedResponse
      } else {
        // Use our server-side API endpoint that handles admin credentials
        const apiResponse = await fetch('/api/now-playing', {
          signal: abortController.signal
        })

        // Handle 429 Too Many Requests from our proxy
        if (apiResponse.status === 429) {
          // Backoff for 5 seconds (proxy might not send Retry-After)
          backoffUntilRef.current = Date.now() + 5000
          setError('Rate limited. Retrying shortly.')
          return
        }

        // Handle 204 No Content (no currently playing track)
        if (apiResponse.status === 204) {
          setData(null)
          return
        }

        // Read response body once (can only be read once)
        const responseText = await apiResponse.text()

        if (!apiResponse.ok) {
          // For errors, try to parse the error response
          let errorData
          try {
            errorData = responseText ? JSON.parse(responseText) : null
          } catch {
            // Not JSON, use text as error message
          }

          // For authentication errors (401/403), clear data
          if (apiResponse.status === 401 || apiResponse.status === 403) {
            setData(null)
            return
          }

          // For other errors, preserve last known state (don't clear data)
          // This prevents UI from showing "No track" when there's a temporary API issue
          setError(
            errorData?.error ||
              `HTTP ${apiResponse.status}: ${apiResponse.statusText}`
          )
          // Don't clear data - keep showing last known track
          return
        }

        // Check if response has content before parsing JSON
        if (!responseText.trim()) {
          setData(null)
          return
        }

        let parsedResponse
        try {
          parsedResponse = JSON.parse(responseText)
        } catch (parseError) {
          // Failed to parse JSON - preserve last known state
          setError('Failed to parse response')
          // Don't clear data - keep showing last known track
          return
        }

        // Check if response is null (explicit no track)
        if (parsedResponse === null) {
          setData(null)
          return
        }

        // Check if response is an error object (from our API)
        if (
          parsedResponse &&
          typeof parsedResponse === 'object' &&
          'error' in parsedResponse
        ) {
          // This is an error response, preserve last known state
          setError(
            parsedResponse.error || 'Failed to get currently playing track'
          )
          // Don't clear data - keep showing last known track
          return
        }

        response = parsedResponse
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

      // For other errors (network issues, parsing errors, etc.), preserve last known state
      // This prevents UI from showing "No track" when there's a temporary issue
      setError(err instanceof Error ? err.message : 'An error occurred')
      // Don't clear data - keep showing last known track
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
  }, [fetchCurrentlyPlaying, refetchInterval, enabled])

  return {
    data,
    error,
    isLoading,
    refetch: fetchCurrentlyPlaying
  }
}

// Default export for backward compatibility
export default useNowPlayingTrack
