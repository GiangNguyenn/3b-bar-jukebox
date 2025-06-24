import useSWR from 'swr'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { TrackItem } from '@/shared/types/spotify'
import { useConsoleLogsContext } from './ConsoleLogsProvider'

interface PlaylistResponse {
  tracks: {
    items: TrackItem[]
  }
}

const createPlaylistFetcher = (playlistId: string) => async () => {
  return handleOperationError(
    async () => {
      const response = await sendApiRequest<PlaylistResponse>({
        path: `playlists/${playlistId}`,
        method: 'GET'
      })
      return response
    },
    'PlaylistFetcher',
    (error) => {
      console.error(`[Playlist] Error fetching playlist ${playlistId}:`, error)
    }
  )
}

export function usePlaylistData(playlistId: string) {
  const { addLog } = useConsoleLogsContext()

  const fetcher = createPlaylistFetcher(playlistId)

  const {
    data: playlist,
    error: playlistError,
    mutate: refreshPlaylist,
    isLoading
  } = useSWR(playlistId ? ['playlist', playlistId] : null, fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onError: (error) => {
      addLog(
        'ERROR',
        `Failed to fetch playlist ${playlistId}`,
        'PlaylistData',
        error instanceof Error ? error : undefined
      )
    }
  })

  return {
    playlist,
    error: playlistError,
    refreshPlaylist,
    isLoading
  }
}
