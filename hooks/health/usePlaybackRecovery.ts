import { useRef, useCallback, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { usePlaybackIntentStore } from '../usePlaybackIntent'
import {
  attemptPlaybackRecovery,
  shouldAttemptRecovery
} from '@/recovery/playbackRecovery'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'
  | 'error'

/**
 * Hook for managing playback recovery logic
 * Separated from health monitoring to improve maintainability
 */
export function usePlaybackRecovery(deviceHealth: DeviceHealthStatus) {
  const { addLog } = useConsoleLogsContext()
  const { userIntent } = usePlaybackIntentStore()

  const userIntentRef = useRef(userIntent)
  const lastRecoveryAttemptRef = useRef<number>(0)
  const consecutiveFailuresRef = useRef<number>(0)
  const isRecoveringRef = useRef<boolean>(false)
  const lastPlaybackStateRef = useRef<SpotifyPlaybackState | null>(null)

  // Keep user intent ref up to date
  useEffect(() => {
    userIntentRef.current = userIntent

    // Reset failure count when user manually pauses
    if (userIntent === 'paused') {
      consecutiveFailuresRef.current = 0
      isRecoveringRef.current = false
    }
  }, [userIntent])

  /**
   * Attempts recovery if conditions are met
   */
  const attemptRecoveryIfNeeded = useCallback(
    async (
      currentPlaybackState: SpotifyPlaybackState | null,
      playbackStatus: 'playing' | 'paused' | 'stopped' | 'unknown' | 'stalled'
    ): Promise<void> => {
      // Store playback state for recovery
      lastPlaybackStateRef.current = currentPlaybackState

      // Check if recovery should be attempted
      if (
        userIntentRef.current === 'playing' &&
        playbackStatus !== 'playing' &&
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
          `Playback status mismatch detected (intent: playing, status: ${playbackStatus}). Attempting recovery...`,
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
    },
    [deviceHealth, addLog]
  )

  /**
   * Resets failure count when playback is progressing normally
   */
  const resetFailureCount = useCallback((): void => {
    consecutiveFailuresRef.current = 0
  }, [])

  /**
   * Gets the last playback state stored for recovery
   */
  const getLastPlaybackState = useCallback((): SpotifyPlaybackState | null => {
    return lastPlaybackStateRef.current
  }, [])

  return {
    attemptRecoveryIfNeeded,
    resetFailureCount,
    getLastPlaybackState
  }
}
