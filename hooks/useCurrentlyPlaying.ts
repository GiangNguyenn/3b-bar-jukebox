import useSWR from 'swr'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { useConsoleLogsContext } from './ConsoleLogsProvider'

const currentlyPlayingFetcher = async () => {
  return handleOperationError(
    async () => {
      const response = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player/currently-playing?market=from_token',
        method: 'GET'
      })
      return response
    },
    'CurrentlyPlayingFetcher',
    (error) => {
      console.error('[Playlist] Error fetching currently playing:', error)
    }
  )
}

export function useCurrentlyPlaying() {
  const { addLog } = useConsoleLogsContext()

  const {
    data: currentlyPlaying,
    error: currentlyPlayingError,
    isLoading
  } = useSWR('currently-playing', currentlyPlayingFetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onError: (error) => {
      addLog(
        'ERROR',
        'Failed to fetch currently playing track',
        'CurrentlyPlaying',
        error instanceof Error ? error : undefined
      )
    }
  })

  return {
    currentlyPlaying,
    error: currentlyPlayingError,
    isLoading
  }
}
