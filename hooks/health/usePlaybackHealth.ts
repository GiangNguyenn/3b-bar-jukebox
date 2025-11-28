import { useState, useRef } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { useSpotifyPlayerStore } from '../useSpotifyPlayer'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { useHealthInterval } from './utils/useHealthInterval'
import { handleHealthError } from './utils/errorHandling'
import { usePlaybackRecovery } from './usePlaybackRecovery'
import { useDeviceHealth } from './useDeviceHealth'

type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown' | 'stalled'

const PLAYBACK_CHECK_INTERVAL = 60000 // 60 seconds - reduced frequency to lower API usage

export function usePlaybackHealth(): PlaybackStatus {
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>('unknown')
  const { addLog } = useConsoleLogsContext()
  const { deviceId } = useSpotifyPlayerStore()
  const deviceHealth = useDeviceHealth(deviceId)
  const { attemptRecoveryIfNeeded, resetFailureCount } =
    usePlaybackRecovery(deviceHealth)
  const lastCheckRef = useRef<{
    progress: number | null
    uri: string | null
  }>({ progress: null, uri: null })

  const checkPlaybackStatus = async (): Promise<void> => {
    try {
      const currentPlaybackState = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!currentPlaybackState || !currentPlaybackState.item) {
        setPlaybackStatus('stopped')
        lastCheckRef.current = { progress: null, uri: null }

        // Attempt recovery if needed
        await attemptRecoveryIfNeeded(null, 'stopped')
        return
      }

      const lastCheck = lastCheckRef.current
      const currentProgress = currentPlaybackState.progress_ms ?? null
      const currentUri = currentPlaybackState.item.uri
      const isActuallyPlaying = currentPlaybackState.is_playing

      // Determine status based on actual Spotify playback state
      let newStatus: PlaybackStatus
      if (!isActuallyPlaying) {
        newStatus = 'paused'
      } else if (lastCheck.uri === null || lastCheck.uri !== currentUri) {
        // New track started
        newStatus = 'playing'
        // Reset failure count on successful track transition
        resetFailureCount()
      } else {
        // Same track, check for progress
        if (
          currentProgress !== null &&
          currentProgress === lastCheck.progress
        ) {
          newStatus = 'stalled'
          addLog(
            'ERROR',
            `Playback stalled. No progress in last 15s via API. Last Progress: ${lastCheck.progress}, Current Progress: ${currentProgress}.`,
            'PlaybackHealth'
          )
        } else {
          newStatus = 'playing'
          // Reset failure count when playback is progressing
          resetFailureCount()
        }
      }

      setPlaybackStatus(newStatus)
      lastCheckRef.current = { progress: currentProgress, uri: currentUri }

      // Attempt recovery if needed
      await attemptRecoveryIfNeeded(currentPlaybackState, newStatus)
    } catch (error) {
      handleHealthError(
        error,
        addLog,
        'PlaybackHealth',
        'Failed to fetch playback state for health check'
      )
    }
  }

  useHealthInterval(checkPlaybackStatus, {
    interval: PLAYBACK_CHECK_INTERVAL,
    enabled: true
  })

  return playbackStatus
}
