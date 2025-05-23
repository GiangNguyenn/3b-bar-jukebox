import { useState, useCallback, useEffect } from 'react'
import { useDeviceManager } from './useDeviceManager'
import { usePlaybackManager } from './usePlaybackManager'
import { useHealthStatus, DeviceHealthStatus } from './useHealthStatus'
import {
  cleanupOtherDevices,
  verifyDeviceTransfer
} from '@/services/deviceManagement'

// Recovery system constants
export const MAX_RECOVERY_RETRIES = 5
export const BASE_DELAY = 1000 // 1 second
export const STALL_THRESHOLD = 5000 // 5 seconds
export const STALL_CHECK_INTERVAL = 2000 // Check every 2 seconds
export const MIN_STALLS_BEFORE_RECOVERY = 2 // Require only 2 stalls
export const PROGRESS_TOLERANCE = 100 // Allow 100ms difference in progress

type RecoveryPhase = 'idle' | 'recovering' | 'success' | 'error'

interface RecoveryState {
  phase: RecoveryPhase
  attempts: number
  error: string | null
  isRecovering: boolean
  message: string
  lastStallCheck?: {
    timestamp: number
    count: number
  }
}

export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onHealthStatusUpdate: (status: { device: DeviceHealthStatus }) => void,
  isInitializing: boolean = false
) {
  // Initialize sub-hooks
  const { state: deviceState, checkDevice } = useDeviceManager(deviceId)
  const { state: playbackState, resumePlayback } =
    usePlaybackManager(fixedPlaylistId)
  const { updateHealth } = useHealthStatus(onHealthStatusUpdate)

  // Main recovery state
  const [state, setState] = useState<RecoveryState>({
    phase: 'idle',
    attempts: 0,
    error: null,
    isRecovering: false,
    message: '',
    lastStallCheck: { timestamp: 0, count: 0 }
  })

  const updateState = useCallback((updates: Partial<RecoveryState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }, [])

  const forceRecovery = useCallback(async (): Promise<void> => {
    console.log('[Force Recovery] Starting forced recovery')

    updateState({
      phase: 'recovering',
      isRecovering: true,
      message: 'Forcing recovery...',
      attempts: 0,
      error: null
    })

    try {
      // Disconnect and reconnect
      if (typeof window.spotifyPlayerInstance?.disconnect === 'function') {
        await window.spotifyPlayerInstance.disconnect()
      }

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Reconnect
      if (typeof window.spotifyPlayerInstance?.connect === 'function') {
        await window.spotifyPlayerInstance.connect()
      }

      // Reinitialize
      if (typeof window.initializeSpotifyPlayer === 'function') {
        await window.initializeSpotifyPlayer()
      }

      updateState({
        phase: 'success',
        isRecovering: false,
        message: 'Forced recovery successful'
      })
    } catch (error) {
      console.error('[Recovery] Forced recovery failed:', error)
      updateState({
        phase: 'error',
        isRecovering: false,
        message: 'Forced recovery failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [updateState])

  const attemptRecovery = useCallback(async (): Promise<void> => {
    // Skip if initializing or already recovering
    if (isInitializing || state.isRecovering) {
      console.log('[Recovery] Skipping recovery - initializing or in progress')
      return
    }

    updateState({
      phase: 'recovering',
      isRecovering: true,
      message: 'Starting recovery...'
    })

    try {
      // Single device check with cleanup
      const deviceOk = await checkDevice()
      if (!deviceOk) {
        throw new Error(deviceState.error || 'Device check failed')
      }

      // Clean up other devices if needed
      if (deviceId) {
        const cleanupOk = await cleanupOtherDevices(deviceId)
        if (!cleanupOk) {
          console.warn(
            '[Recovery] Device cleanup failed, but continuing recovery'
          )
        }
      }

      // Resume playback
      const playbackOk = await resumePlayback(
        deviceId!,
        `spotify:playlist:${fixedPlaylistId}`
      )
      if (!playbackOk) {
        throw new Error(playbackState.error || 'Playback resume failed')
      }

      // Success
      updateHealth('healthy')
      updateState({
        phase: 'success',
        attempts: 0,
        error: null,
        isRecovering: false,
        message: 'Recovery successful',
        lastStallCheck: { timestamp: 0, count: 0 }
      })

      // Reset to idle after delay
      setTimeout(() => {
        updateState({
          phase: 'idle',
          message: ''
        })
      }, 2000)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const newAttempts = state.attempts + 1

      updateState({
        phase: 'error',
        attempts: newAttempts,
        error: errorMessage,
        isRecovering: false,
        message: errorMessage
      })

      // Handle max attempts
      if (newAttempts >= MAX_RECOVERY_RETRIES) {
        console.error('[Recovery] Max attempts reached, reloading page')
        window.location.reload()
        return
      }

      // Schedule next attempt with exponential backoff
      setTimeout(
        () => {
          void attemptRecovery()
        },
        BASE_DELAY * Math.pow(2, newAttempts)
      )
    }
  }, [
    deviceId,
    fixedPlaylistId,
    state.isRecovering,
    state.attempts,
    deviceState.error,
    playbackState.error,
    updateHealth,
    updateState,
    checkDevice,
    resumePlayback,
    isInitializing
  ])

  // Add a reset function to manually reset the state
  const reset = useCallback(() => {
    setState({
      phase: 'idle',
      attempts: 0,
      error: null,
      isRecovering: false,
      message: '',
      lastStallCheck: { timestamp: 0, count: 0 }
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      updateHealth('unknown')
      reset()
    }
  }, [updateHealth, reset])

  return {
    state,
    attemptRecovery,
    forceRecovery,
    deviceState,
    playbackState,
    reset
  }
}
