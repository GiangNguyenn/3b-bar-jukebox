import { useState, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'

type FixedPlaylistStatus = 'found' | 'not_found' | 'error' | 'unknown'

export function useFixedPlaylistHealth(
  fixedPlaylistId: string | null,
  isFixedPlaylistLoading?: boolean,
  fixedPlaylistError?: Error | null
): FixedPlaylistStatus {
  const [playlistStatus, setPlaylistStatus] =
    useState<FixedPlaylistStatus>('unknown')
  const { addLog } = useConsoleLogsContext()

  useEffect(() => {
    if (isFixedPlaylistLoading) {
      // Still loading
      setPlaylistStatus('unknown')
      return
    }

    if (fixedPlaylistError) {
      // Error occurred
      setPlaylistStatus('error')
      addLog(
        'ERROR',
        `Fixed playlist error: ${fixedPlaylistError.message}`,
        'FixedPlaylistHealth'
      )
      return
    }

    if (fixedPlaylistId) {
      // Playlist found
      setPlaylistStatus('found')
      addLog(
        'INFO',
        `Fixed playlist found: ${fixedPlaylistId}`,
        'FixedPlaylistHealth'
      )
    } else {
      // No playlist found
      setPlaylistStatus('not_found')
      addLog('WARN', 'No fixed playlist found', 'FixedPlaylistHealth')
    }
  }, [fixedPlaylistId, isFixedPlaylistLoading, fixedPlaylistError, addLog])

  return playlistStatus
}
