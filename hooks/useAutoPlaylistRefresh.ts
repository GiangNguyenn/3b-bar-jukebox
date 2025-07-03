import { useEffect, useRef } from 'react'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const AUTO_REFRESH_INTERVAL = 180000 // 3 minutes

interface UseAutoPlaylistRefreshProps {
  isEnabled?: boolean
  trackSuggestionsState?: TrackSuggestionsState
  refreshPlaylist: (
    trackSuggestionsState?: TrackSuggestionsState
  ) => Promise<void>
}

export function useAutoPlaylistRefresh({
  isEnabled = true,
  trackSuggestionsState,
  refreshPlaylist
}: UseAutoPlaylistRefreshProps): void {
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const { addLog } = useConsoleLogsContext()

  useEffect(() => {
    if (!isEnabled) {
      return
    }

    const performAutoRefresh = async (): Promise<void> => {
      try {
        addLog('INFO', 'Auto-refreshing playlist...', 'AutoPlaylistRefresh')

        await refreshPlaylist(trackSuggestionsState)

        addLog(
          'INFO',
          'Auto-playlist refresh completed successfully',
          'AutoPlaylistRefresh'
        )
      } catch (error) {
        // Check if the error is an expected behavior
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('Enough tracks remaining')) {
          addLog(
            'INFO',
            'Auto-playlist refresh: Enough tracks remaining, no action needed',
            'AutoPlaylistRefresh'
          )
        } else if (
          errorMessage.includes('Refresh operation already in progress')
        ) {
          addLog(
            'INFO',
            'Auto-playlist refresh: Refresh operation already in progress, skipping',
            'AutoPlaylistRefresh'
          )
        } else if (
          errorMessage.includes('Playlist has reached maximum length')
        ) {
          addLog(
            'INFO',
            'Auto-playlist refresh: Playlist at maximum length, no new tracks needed',
            'AutoPlaylistRefresh'
          )
        } else {
          addLog(
            'ERROR',
            'Auto-playlist refresh error',
            'AutoPlaylistRefresh',
            error instanceof Error ? error : undefined
          )
        }
      }
    }

    // Set up the interval
    intervalRef.current = setInterval(performAutoRefresh, AUTO_REFRESH_INTERVAL)

    // Perform initial refresh after a delay to avoid interfering with user actions
    const initialRefreshTimeout = setTimeout(performAutoRefresh, 30000) // 30 seconds

    addLog(
      'INFO',
      'Auto-playlist refresh enabled (every 3 minutes)',
      'AutoPlaylistRefresh'
    )

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      clearTimeout(initialRefreshTimeout)
      addLog('INFO', 'Auto-playlist refresh disabled', 'AutoPlaylistRefresh')
    }
  }, [isEnabled, trackSuggestionsState, refreshPlaylist, addLog])
}
