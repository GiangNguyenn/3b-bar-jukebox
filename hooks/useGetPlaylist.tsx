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

export const useGetPlaylist = (id: string) => {
  const fetcher = async () => {
    if (!id) return null

    // Check cache first
    const cacheKey = `playlist-${id}`
    const cachedData = cache.get<SpotifyPlaylistItem>(cacheKey)
    if (cachedData) {
      return cachedData
    }

    // If not in cache, fetch from API
    const data = await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${id}`
    })

    // Cache the result
    cache.set(cacheKey, data)
    return data
  }

  const { data, error, mutate } = useSWR(`playlist-${id}`, fetcher, {
    refreshInterval: 30000, // Refresh every 30 seconds
    revalidateOnFocus: true,
    revalidateOnReconnect: true
  })

  const refetchPlaylist = async () => {
    await handleOperationError(async () => {
      // Clear the cache first
      cache.delete(`playlist-${id}`)

      // Force a revalidation with fresh data
      await mutate(
        async () => {
          const newData = await sendApiRequest<SpotifyPlaylistItem>({
            path: `playlists/${id}`
          })
          // Update cache with new data
          cache.set(`playlist-${id}`, newData)
          return newData
        },
        {
          revalidate: true,
          populateCache: true,
          rollbackOnError: true
        }
      )
    }, 'Get Playlist')
  }

  return {
    data,
    isLoading: !error && !data,
    isError: error,
    refetchPlaylist
  }
}
