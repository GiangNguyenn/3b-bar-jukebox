import { useState, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown'

export function usePlaybackHealth(
  playbackState: SpotifyPlaybackState | null
): PlaybackStatus {
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>('unknown')
  const { addLog } = useConsoleLogsContext()

  useEffect(() => {
    addLog(
      'INFO',
      `Playback status effect: playbackState=${JSON.stringify(playbackState)}`,
      'PlaybackHealth'
    )

    if (!playbackState) {
      setPlaybackStatus('unknown')
      addLog('INFO', 'Set playback status to unknown', 'PlaybackHealth')
      return
    }

    if (playbackState.is_playing) {
      setPlaybackStatus('playing')
      addLog('INFO', 'Set playback status to playing', 'PlaybackHealth')
    } else if (playbackState.item) {
      setPlaybackStatus('paused')
      addLog('INFO', 'Set playback status to paused', 'PlaybackHealth')
    } else {
      setPlaybackStatus('stopped')
      addLog('INFO', 'Set playback status to stopped', 'PlaybackHealth')
    }
  }, [playbackState, addLog])

  return playbackStatus
}
