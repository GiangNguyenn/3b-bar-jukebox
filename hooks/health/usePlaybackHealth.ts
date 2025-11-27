import { useState, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { usePlaybackIntentStore } from '../usePlaybackIntent'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import {
  attemptPlaybackRecovery,
  shouldAttemptRecovery
} from '@/recovery/playbackRecovery'
import { useDeviceHealth } from './useDeviceHealth'
import { useSpotifyPlayerStore } from '../useSpotifyPlayer'

type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown' | 'stalled'

export function usePlaybackHealth(): PlaybackStatus {
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>('unknown')
  const { addLog } = useConsoleLogsContext()
  const { userIntent } = usePlaybackIntentStore()
  const { deviceId } = useSpotifyPlayerStore()
  const deviceHealth = useDeviceHealth(deviceId)
  const lastCheckRef = useRef<{
    progress: number | null
    uri: string | null
  }>({ progress: null, uri: null })

  const userIntentRef = useRef(userIntent)
  const lastRecoveryAttemptRef = useRef<number>(0)
  const consecutiveFailuresRef = useRef<number>(0)
  const isRecoveringRef = useRef<boolean>(false)
  const lastPlaybackStateRef = useRef<SpotifyPlaybackState | null>(null)

  useEffect(() => {
    userIntentRef.current = userIntent

    // Reset failure count when user manually pauses
    if (userIntent === 'paused') {
      consecutiveFailuresRef.current = 0
      isRecoveringRef.current = false
    }
  }, [userIntent])

  useEffect(() => {
    const intervalId = setInterval(async () => {
      try {
        const currentPlaybackState = await sendApiRequest<SpotifyPlaybackState>(
          {
            path: 'me/player',
            method: 'GET'
          }
        )

        if (!currentPlaybackState || !currentPlaybackState.item) {
          setPlaybackStatus('stopped')
          lastCheckRef.current = { progress: null, uri: null }
          lastPlaybackStateRef.current = null

          // Check if recovery should be attempted
          if (
            userIntentRef.current === 'playing' &&
            !isRecoveringRef.current &&
            shouldAttemptRecovery(
              lastRecoveryAttemptRef.current,
              consecutiveFailuresRef.current
            ) &&
            deviceHealth === 'healthy'
          ) {
            isRecoveringRef.current = true
            lastRecoveryAttemptRef.current = Date.now()

            addLog(
              'WARN',
              'Playback stopped but user intent is playing. Attempting recovery...',
              'PlaybackHealth'
            )

            const recoveryResult = await attemptPlaybackRecovery(
              lastPlaybackStateRef.current,
              consecutiveFailuresRef.current,
              addLog
            )

            consecutiveFailuresRef.current = recoveryResult.consecutiveFailures
            isRecoveringRef.current = false

            if (recoveryResult.success) {
              addLog(
                'INFO',
                `Playback recovery successful using strategy: ${recoveryResult.strategy}`,
                'PlaybackHealth'
              )
            } else if (recoveryResult.nextAttemptAllowedAt) {
              const nextAttempt = new Date(
                recoveryResult.nextAttemptAllowedAt
              ).toISOString()
              addLog(
                'WARN',
                `Playback recovery failed. Next attempt allowed at: ${nextAttempt}`,
                'PlaybackHealth',
                recoveryResult.error
              )
            }
          }

          return
        }

        const lastCheck = lastCheckRef.current
        const currentProgress = currentPlaybackState.progress_ms ?? null
        const currentUri = currentPlaybackState.item.uri
        const isActuallyPlaying = currentPlaybackState.is_playing

        // Store playback state for recovery
        lastPlaybackStateRef.current = currentPlaybackState

        // Determine status based on actual Spotify playback state
        let newStatus: PlaybackStatus
        if (!isActuallyPlaying) {
          newStatus = 'paused'
        } else if (lastCheck.uri === null || lastCheck.uri !== currentUri) {
          // New track started
          newStatus = 'playing'
          // Reset failure count on successful track transition
          consecutiveFailuresRef.current = 0
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
            consecutiveFailuresRef.current = 0
          }
        }

        setPlaybackStatus(newStatus)
        lastCheckRef.current = { progress: currentProgress, uri: currentUri }

        // Check if recovery should be attempted
        if (
          userIntentRef.current === 'playing' &&
          newStatus !== 'playing' &&
          newStatus !== 'unknown' &&
          !isRecoveringRef.current &&
          shouldAttemptRecovery(
            lastRecoveryAttemptRef.current,
            consecutiveFailuresRef.current
          ) &&
          deviceHealth === 'healthy'
        ) {
          // Double-check user intent hasn't changed
          if (userIntentRef.current !== 'playing') {
            return
          }

          isRecoveringRef.current = true
          lastRecoveryAttemptRef.current = Date.now()

          addLog(
            'WARN',
            `Playback status mismatch detected (intent: playing, status: ${newStatus}). Attempting recovery...`,
            'PlaybackHealth'
          )

          const recoveryResult = await attemptPlaybackRecovery(
            currentPlaybackState,
            consecutiveFailuresRef.current,
            addLog
          )

          consecutiveFailuresRef.current = recoveryResult.consecutiveFailures
          isRecoveringRef.current = false

          if (recoveryResult.success) {
            addLog(
              'INFO',
              `Playback recovery successful using strategy: ${recoveryResult.strategy}`,
              'PlaybackHealth'
            )
            // Reset failure count on success
            consecutiveFailuresRef.current = 0
          } else if (recoveryResult.nextAttemptAllowedAt) {
            const nextAttempt = new Date(
              recoveryResult.nextAttemptAllowedAt
            ).toISOString()
            addLog(
              'WARN',
              `Playback recovery failed. Next attempt allowed at: ${nextAttempt}`,
              'PlaybackHealth',
              recoveryResult.error
            )
          }
        }
      } catch (error) {
        addLog(
          'ERROR',
          'Failed to fetch playback state for health check.',
          'PlaybackHealth',
          error instanceof Error ? error : undefined
        )
      }
    }, 60000) // Check every 60 seconds - reduced frequency to lower API usage

    return () => clearInterval(intervalId)
  }, [addLog, deviceHealth, deviceId])

  return playbackStatus
}
