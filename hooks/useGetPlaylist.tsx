import { useEffect, useState, useRef, useCallback } from 'react'
import { SpotifyPlaylistItem, TrackItem } from '@/shared/types/spotify'
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
  const [hasOptimisticUpdates, setHasOptimisticUpdates] = useState(false)
  const optimisticUpdateTimeRef = useRef<number>(0)

  const fetchPlaylist = async (
    bypassCache = false,
    isBackgroundRefresh = false
  ) => {
    if (!playlistId) {
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

    // Skip background refresh if there are optimistic updates and it's been less than 10 seconds
    if (isBackgroundRefresh && hasOptimisticUpdates) {
      const timeSinceOptimisticUpdate =
        Date.now() - optimisticUpdateTimeRef.current
      if (timeSinceOptimisticUpdate < 10000) {
        // 10 seconds
        console.log(
          '[useGetPlaylist] Skipping background refresh due to recent optimistic updates'
        )
        return
      }
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
            // Note: The recovery is now handled by the page component
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

      // Clear optimistic updates flag after successful fetch
      if (hasOptimisticUpdates) {
        setHasOptimisticUpdates(false)
      }
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

  // Optimistic update function to immediately add a track to the playlist
  const addTrackOptimistically = useCallback(
    (track: TrackItem) => {
      if (!data || !playlistId) {
        console.log(
          '[useGetPlaylist] Cannot add track optimistically - no data or playlistId:',
          { data: !!data, playlistId }
        )
        return
      }

      console.log(
        '[useGetPlaylist] Adding track optimistically:',
        track.track.name,
        'Current tracks count:',
        data.tracks.items.length
      )

      const optimisticPlaylist: SpotifyPlaylistItem = {
        ...data,
        tracks: {
          ...data.tracks,
          items: [
            ...data.tracks.items,
            {
              ...track,
              added_at: new Date().toISOString(),
              added_by: {
                id: 'optimistic',
                uri: 'spotify:user:optimistic',
                href: 'https://api.spotify.com/v1/users/optimistic',
                external_urls: {
                  spotify: 'https://open.spotify.com/user/optimistic'
                },
                type: 'user'
              }
            }
          ]
        }
      }

      // Update both state and cache
      setData(optimisticPlaylist)
      const cacheKey = `playlist-${playlistId}`
      cache.set(cacheKey, optimisticPlaylist)

      // Set flag to prevent background refresh from overriding optimistic updates
      setHasOptimisticUpdates(true)
      optimisticUpdateTimeRef.current = Date.now()

      console.log(
        '[useGetPlaylist] Optimistically added track:',
        track.track.name,
        'New tracks count:',
        optimisticPlaylist.tracks.items.length
      )
    },
    [data, playlistId]
  )

  // Optimistic update function to immediately remove a track from the playlist
  const removeTrackOptimistically = useCallback(
    (trackUri: string) => {
      if (!data || !playlistId) return

      const optimisticPlaylist: SpotifyPlaylistItem = {
        ...data,
        tracks: {
          ...data.tracks,
          items: data.tracks.items.filter((item) => item.track.uri !== trackUri)
        }
      }

      // Update both state and cache
      setData(optimisticPlaylist)
      const cacheKey = `playlist-${playlistId}`
      cache.set(cacheKey, optimisticPlaylist)

      // Set flag to prevent background refresh from overriding optimistic updates
      setHasOptimisticUpdates(true)
      optimisticUpdateTimeRef.current = Date.now()

      console.log('[useGetPlaylist] Optimistically removed track:', trackUri)
    },
    [data, playlistId]
  )

  // Function to revert optimistic updates (used on error)
  const revertOptimisticUpdate = useCallback(() => {
    if (!playlistId) return

    const cacheKey = `playlist-${playlistId}`
    cache.delete(cacheKey)
    setHasOptimisticUpdates(false)
    void fetchPlaylist(true, false)
  }, [playlistId])

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
      setHasOptimisticUpdates(false)
      return fetchPlaylist(true, true) // Mark as background refresh for manual refetch too
    },
    addTrackOptimistically,
    removeTrackOptimistically,
    revertOptimisticUpdate
  }
}

// Default export for backward compatibility
export default useGetPlaylist
