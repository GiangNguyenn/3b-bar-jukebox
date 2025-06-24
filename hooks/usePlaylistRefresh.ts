import { useCallback } from 'react'
import { sendApiRequest } from '@/shared/api'
import { TrackItem } from '@/shared/types/spotify'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { useConsoleLogsContext } from './ConsoleLogsProvider'

interface PlaylistResponse {
  tracks: {
    items: TrackItem[]
  }
}

export function usePlaylistRefresh(
  playlistId: string,
  refreshPlaylist: () => Promise<any>
) {
  const { addLog } = useConsoleLogsContext()

  const handleRefresh = useCallback(
    async (trackSuggestionsState?: TrackSuggestionsState) => {
      try {
        const playlistRefreshService = PlaylistRefreshServiceImpl.getInstance()
        const result = await playlistRefreshService.refreshPlaylist(
          false,
          trackSuggestionsState
        )

        if (!result.success) {
          // Don't throw for expected behaviors
          if (result.message === 'Enough tracks remaining') {
            addLog(
              'INFO',
              'Enough tracks remaining, no action needed',
              'PlaylistRefresh'
            )
          } else if (
            result.message === 'Refresh operation already in progress'
          ) {
            addLog(
              'INFO',
              'Refresh operation already in progress, skipping',
              'PlaylistRefresh'
            )
          } else if (
            result.message.includes('Playlist has reached maximum length')
          ) {
            addLog(
              'INFO',
              'Playlist at maximum length, no new tracks needed',
              'PlaylistRefresh'
            )
          } else {
            throw new Error(result.message)
          }
        }

        // Force a revalidation with fresh data to update UI
        await refreshPlaylist()

        addLog(
          'INFO',
          'Playlist refresh completed successfully',
          'PlaylistRefresh'
        )
      } catch (error) {
        addLog(
          'ERROR',
          `Error refreshing playlist ${playlistId}`,
          'PlaylistRefresh',
          error instanceof Error ? error : undefined
        )
        throw error
      }
    },
    [playlistId, refreshPlaylist, addLog]
  )

  return handleRefresh
}
