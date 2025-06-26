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
  const lastTrackUriRef = useRef<string | null>(null)

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

    if (!playbackState || !playbackState.item) {
      setPlaybackStatus(playbackState ? 'stopped' : 'unknown')
      addLog(
        'INFO',
        `Set playback status to ${playbackState ? 'stopped' : 'unknown'}`,
        'PlaybackHealth'
      )
      lastProgressRef.current = null
      lastTrackUriRef.current = null
      return
    }

    const currentTrackUri = playbackState.item.uri

    // Reset stall detection if track changes
    if (lastTrackUriRef.current !== currentTrackUri) {
      lastProgressRef.current = null
      lastTrackUriRef.current = currentTrackUri
      addLog(
        'INFO',
        `Track changed to: ${currentTrackUri}. Resetting stall detection.`,
        'PlaybackHealth'
      )
    }

    if (playbackState.is_playing) {
      const now = Date.now()
      const currentProgress = playbackState.progress_ms ?? 0

      if (lastProgressRef.current) {
        const timeDiff = now - lastProgressRef.current.timestamp
        const progressDiff = currentProgress - lastProgressRef.current.progress

        // More lenient stall detection
        if (timeDiff > 5000 && progressDiff < 1000) {
          setPlaybackStatus('stalled')
          addLog(
            'ERROR',
            `Playback has stalled. Progress diff: ${progressDiff} in ${timeDiff}ms`,
            'PlaybackHealth'
          )
        } else {
          setPlaybackStatus('playing')
        }
      } else {
        setPlaybackStatus('playing')
        addLog('INFO', 'Set playback status to playing', 'PlaybackHealth')
      }
      lastProgressRef.current = { progress: currentProgress, timestamp: now }
    } else {
      setPlaybackStatus('paused')
      addLog('INFO', 'Set playback status to paused', 'PlaybackHealth')
      lastProgressRef.current = null
    }
  }, [playbackState, addLog])

  return playbackStatus
}
