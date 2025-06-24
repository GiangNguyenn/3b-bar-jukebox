import { useEffect, useState, useRef } from 'react'
import { SpotifyPlaylistItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { cache } from '@/shared/utils/cache'

interface UseGetPlaylistProps {
  playlistId: string | null
  token?: string | null
  enabled?: boolean
}

export function useGetPlaylist({
  playlistId,
  token,
  enabled = true
}: UseGetPlaylistProps) {
  const [data, setData] = useState<SpotifyPlaylistItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchPlaylist = async (
    bypassCache = false,
    isBackgroundRefresh = false
  ) => {
    if (!enabled || !playlistId) {
      setData(null)
      return
    }

    if (enabled && !token) {
      setData(null)
      return
    }

    if (playlistId === 'user' || !playlistId.match(/^[a-zA-Z0-9]{22}$/)) {
      console.error('[useGetPlaylist] Invalid playlist ID format:', playlistId)
      setError('Invalid playlist ID format')
      return
    }

    try {
      // Use different loading states for initial load vs background refresh
      if (isBackgroundRefresh) {
        setIsRefreshing(true)
      } else {
        setIsLoading(true)
      }
      setError(null)

      const cacheKey = `playlist-${playlistId}`

      // Only check cache if not bypassing it
      if (!bypassCache) {
        const cachedData = cache.get<SpotifyPlaylistItem>(cacheKey)
        if (cachedData) {
          setData(cachedData)
          return
        }
      }

      let playlistData: SpotifyPlaylistItem

      if (token) {
        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        )

        if (!response.ok) {
          if (response.status === 401) {
            setError('Token invalid')
            return
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        playlistData = await response.json()
      } else {
        console.error(
          '[useGetPlaylist] No token provided but enabled is true - this should not happen'
        )
        setError('No token provided')
        return
      }

      cache.set(cacheKey, playlistData)
      setData(playlistData)
    } catch (err) {
      console.error('[useGetPlaylist] Error:', err)

      if (err instanceof Error && err.message.includes('401')) {
        setError('User not authenticated')
        return
      }

      setError(err instanceof Error ? err.message : 'An error occurred')
      setData(null)
    } finally {
      // Use different loading states for initial load vs background refresh
      if (isBackgroundRefresh) {
        setIsRefreshing(false)
      } else {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!enabled) {
      return
    }

    // Initial fetch
    void fetchPlaylist()

    // Set up automatic refresh every minute (60000ms)
    intervalRef.current = setInterval(() => {
      void fetchPlaylist(true, true) // Always bypass cache for auto-refresh, mark as background refresh
    }, 60000)

    // Cleanup interval on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [playlistId, token, enabled])

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    refetch: () => {
      // Clear cache and fetch fresh data
      if (playlistId) {
        const cacheKey = `playlist-${playlistId}`
        cache.delete(cacheKey)
      }
      return fetchPlaylist(true, true) // Mark as background refresh for manual refetch too
    }
  }
}

// Default export for backward compatibility
export default useGetPlaylist
