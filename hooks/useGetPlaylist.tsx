import { SpotifyPlaylistItem } from '@/shared/types'
import { sendApiRequest } from '@/shared/api'
import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'
import useSWR from 'swr'
import {
  handleApiError,
  handleOperationError
} from '@/shared/utils/errorHandling'
import { cache } from '@/shared/utils/cache'

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? ''

export const useGetPlaylist = (id: string | null) => {
  const fetcher = async () => {
    if (!id) {
      console.log('[GetPlaylist] No playlist ID provided, skipping fetch')
      return null
    }

    // Validate playlist ID format
    if (id === 'user' || !id.match(/^[a-zA-Z0-9]{22}$/)) {
      console.error('[GetPlaylist] Invalid playlist ID format:', id)
      return null
    }

    // Check cache first
    const cacheKey = `playlist-${id}`
    const cachedData = cache.get<SpotifyPlaylistItem>(cacheKey)
    if (cachedData) {
      console.log('[GetPlaylist] Using cached data for playlist:', {
        id,
        name: cachedData.name,
        trackCount: cachedData.tracks.items.length
      })
      return cachedData
    }

    console.log('[GetPlaylist] Fetching playlist:', id)
    // If not in cache, fetch from API
    const data = await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${id}`
    })

    console.log('[GetPlaylist] Successfully fetched playlist:', {
      id,
      name: data.name,
      trackCount: data.tracks.items.length
    })

    // Cache the result
    cache.set(cacheKey, data)
    return data
  }

  const { data, error, mutate } = useSWR(
    id ? `playlist-${id}` : null,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      onError: (err) => {
        console.error('[GetPlaylist] SWR Error:', err, {
          playlistId: id,
          timestamp: new Date().toISOString()
        })
      },
      onSuccess: (data) => {
        if (data) {
          console.log('[GetPlaylist] Successfully fetched playlist:', {
            id,
            name: data.name,
            trackCount: data.tracks.items.length
          })
        }
      }
    }
  )

  const refetchPlaylist = async (optimisticData?: SpotifyPlaylistItem) => {
    if (!id) {
      console.log('[GetPlaylist] No playlist ID provided, skipping refetch')
      return null
    }
    console.log('[GetPlaylist] Refetching playlist:', id)
    if (optimisticData) {
      return mutate(optimisticData, { revalidate: false })
    }
    return mutate()
  }

  return {
    data,
    error,
    isLoading: !data && !error,
    isError: !!error,
    refetchPlaylist
  }
}
