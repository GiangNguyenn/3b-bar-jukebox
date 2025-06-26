import { useState, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown' | 'stalled'

export function usePlaybackHealth(
  playbackState: SpotifyPlaybackState | null
): PlaybackStatus {
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>('unknown')
  const { addLog } = useConsoleLogsContext()
  const lastProgressRef = useRef<{
    progress: number
    timestamp: number
  } | null>(null)
  const stallTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    addLog(
      'INFO',
      `Playback status effect: playbackState=${JSON.stringify(playbackState)}`,
      'PlaybackHealth'
    )

    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }

    if (!playbackState) {
      setPlaybackStatus('unknown')
      addLog('INFO', 'Set playback status to unknown', 'PlaybackHealth')
      lastProgressRef.current = null
      return
    }

    if (playbackState.is_playing) {
      const now = Date.now()
      const currentProgress = playbackState.progress_ms ?? 0

      if (lastProgressRef.current) {
        const timeDiff = now - lastProgressRef.current.timestamp
        const progressDiff = currentProgress - lastProgressRef.current.progress

        if (timeDiff > 4000 && progressDiff < 1000) {
          setPlaybackStatus('stalled')
          addLog('ERROR', 'Playback has stalled.', 'PlaybackHealth')
        } else {
          setPlaybackStatus('playing')
          addLog('INFO', 'Set playback status to playing', 'PlaybackHealth')
        }
      } else {
        setPlaybackStatus('playing')
        addLog('INFO', 'Set playback status to playing', 'PlaybackHealth')
      }
      lastProgressRef.current = { progress: currentProgress, timestamp: now }
    } else if (playbackState.item) {
      setPlaybackStatus('paused')
      addLog('INFO', 'Set playback status to paused', 'PlaybackHealth')
      lastProgressRef.current = null
    } else {
      setPlaybackStatus('stopped')
      addLog('INFO', 'Set playback status to stopped', 'PlaybackHealth')
      lastProgressRef.current = null
    }
  }, [playbackState, addLog])

  return playbackStatus
}
