import useSWR from 'swr'
import { sendApiRequest } from '../shared/api'
import { SpotifyPlaylistItem } from '@/shared/types/spotify'

export const useMyPlaylists = () => {
  const fetcher = async () => {
    console.log('[MyPlaylists] Fetching user playlists')
    const response = await sendApiRequest<{ items: SpotifyPlaylistItem[] }>({
      path: 'me/playlists'
    })
    console.log('[MyPlaylists] Successfully fetched playlists:', {
      count: response?.items?.length ?? 0
    })
    return response
  }

  const { data, error, mutate, isLoading } = useSWR('my-playlists', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false
  })

  return {
    data,
    isLoading: isLoading || error,
    isError: error,
    refetchPlaylists: mutate
  }
}
