import { useEffect, useState, useRef, useCallback } from 'react'
import { SpotifyPlaylistItem, TrackItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { cache } from '@/shared/utils/cache'

// Module-level cache to track in-flight requests
const inFlightRequests = new Map<string, Promise<SpotifyPlaylistItem>>()

interface UseGetPlaylistOptions {
  playlistId: string | null
  token?: string | null
  enabled?: boolean
  refetchInterval?: number | null
}

export function useGetPlaylist({
  playlistId,
  token,
  enabled = true,
  refetchInterval = 60000
}: UseGetPlaylistOptions) {
  const [data, setData] = useState<SpotifyPlaylistItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const [hasOptimisticUpdates, setHasOptimisticUpdates] = useState(false)
  const optimisticUpdateTimeRef = useRef<number>(0)

  const fetchPlaylist = useCallback(
    async (bypassCache = false, isBackgroundRefresh = false) => {
      if (!playlistId) {
        setData(null)
        return
      }

      if (enabled && !token) {
        setData(null)
        return
      }

      if (playlistId === 'user' || !playlistId.match(/^[a-zA-Z0-9]{22}$/)) {
        console.error(
          '[useGetPlaylist] Invalid playlist ID format:',
          playlistId
        )
        setError('Invalid playlist ID format')
        return
      }

      const cacheKey = `playlist-${playlistId}`

      // Prevent duplicate requests
      if (inFlightRequests.has(cacheKey)) {
        try {
          const data = await inFlightRequests.get(cacheKey)
          setData(data as SpotifyPlaylistItem)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'An error occurred')
        }
        return
      }

      try {
        if (isBackgroundRefresh) {
          setIsRefreshing(true)
        } else {
          setIsLoading(true)
        }
        setError(null)

        if (!bypassCache) {
          const cachedData = cache.get<SpotifyPlaylistItem>(cacheKey)
          if (cachedData) {
            setData(cachedData)
            return
          }
        }

        const requestPromise = sendApiRequest<SpotifyPlaylistItem>({
          path: `playlists/${playlistId}`,
          token: token ?? undefined
        })

        inFlightRequests.set(cacheKey, requestPromise)

        const playlistData = await requestPromise
        cache.set(cacheKey, playlistData)
        setData(playlistData)

        if (hasOptimisticUpdates) {
          setHasOptimisticUpdates(false)
        }
      } catch (err) {
        console.error('[useGetPlaylist] Error:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
        setData(null)
      } finally {
        inFlightRequests.delete(cacheKey)
        if (isBackgroundRefresh) {
          setIsRefreshing(false)
        } else {
          setIsLoading(false)
        }
      }
    },
    [playlistId, token, enabled, hasOptimisticUpdates]
  )

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
  }, [playlistId, fetchPlaylist])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void fetchPlaylist()

    if (refetchInterval && refetchInterval > 0) {
      intervalRef.current = setInterval(() => {
        void fetchPlaylist(true, true)
      }, refetchInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, fetchPlaylist, refetchInterval])

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
      return fetchPlaylist(true, true)
    },
    addTrackOptimistically,
    removeTrackOptimistically,
    revertOptimisticUpdate
  }
}

// Default export for backward compatibility
export default useGetPlaylist
