import useSWR from 'swr'
import { sendApiRequest } from '../shared/api'
import { SpotifyPlaylists } from '@/shared/types'

export const useMyPlaylists = () => {
  const fetcher = async () => {
    const response = await sendApiRequest<SpotifyPlaylists>({
      path: 'me/playlists'
    })
    return response
  }

  const { data, error, mutate, isLoading } = useSWR('playlists', fetcher)

  return {
    data,
    isLoading: isLoading || error,
    isError: error,
    refetchPlaylists: mutate
  }
}
