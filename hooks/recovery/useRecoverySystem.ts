import { useState, useCallback, useEffect } from 'react'
import { useDeviceManager } from './useDeviceManager'
import { usePlaybackManager } from './usePlaybackManager'
import { useHealthStatus, DeviceHealthStatus } from './useHealthStatus'
import {
  cleanupOtherDevices,
  verifyDeviceTransfer
} from '@/services/deviceManagement'

// Recovery system constants
const MAX_RECOVERY_RETRIES = 5
const BASE_DELAY = 1000 // 1 second

type RecoveryPhase = 'idle' | 'recovering' | 'success' | 'error'

interface RecoveryState {
  phase: RecoveryPhase
  attempts: number
  error: string | null
  isRecovering: boolean
  message: string
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
    message: ''
  })

  const updateState = useCallback((updates: Partial<RecoveryState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }, [])

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
        message: 'Recovery successful'
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
      message: ''
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
    deviceState,
    playbackState,
    reset
  }
}
