import { useState, useCallback, useEffect } from 'react'
import { useDeviceManager } from './useDeviceManager'
import { usePlaybackManager } from './usePlaybackManager'
import { useCircuitBreaker } from './useCircuitBreaker'
import { useHealthStatus, DeviceHealthStatus } from './useHealthStatus'
import { ErrorType } from '@/shared/types/recovery'
import { cleanupOtherDevices } from '@/services/deviceManagement'

// Recovery system constants
const MAX_RECOVERY_RETRIES = 5
const BASE_DELAY = 1000 // 1 second

type RecoveryPhase =
  | 'idle'
  | 'checking_device'
  | 'checking_playback'
  | 'resuming'
  | 'success'
  | 'error'

interface RecoveryState {
  phase: RecoveryPhase
  attempts: number
  error: string | null
  progress: number
  isRecovering: boolean
  status: {
    message: string
    progress: number
  }
  currentStep: number
  totalSteps: number
}

export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onHealthStatusUpdate: (status: { device: DeviceHealthStatus }) => void
) {
  // Initialize sub-hooks
  const { state: deviceState, checkDevice } = useDeviceManager(deviceId)
  const { state: playbackState, resumePlayback } =
    usePlaybackManager(fixedPlaylistId)
  const { isCircuitOpen, recordFailure, recordSuccess } = useCircuitBreaker(
    3,
    30000
  )
  const { updateHealth } = useHealthStatus(onHealthStatusUpdate)

  // Main recovery state
  const [state, setState] = useState<RecoveryState>({
    phase: 'idle',
    attempts: 0,
    error: null,
    progress: 0,
    isRecovering: false,
    status: {
      message: '',
      progress: 0
    },
    currentStep: 0,
    totalSteps: 0
  })

  const updateState = useCallback((updates: Partial<RecoveryState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }, [])

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (isCircuitOpen()) {
      console.log('[Recovery] Circuit breaker active, skipping recovery')
      return
    }

    if (state.phase !== 'idle') {
      console.log('[Recovery] Recovery already in progress')
      return
    }

    try {
      // Step 1: Check device
      updateState({
        phase: 'checking_device',
        progress: 25,
        isRecovering: true,
        status: {
          message: 'Checking device...',
          progress: 25
        },
        currentStep: 1,
        totalSteps: 3
      })
      const deviceOk = await checkDevice()
      if (!deviceOk) {
        recordFailure()
        updateHealth('disconnected')
        throw new Error(deviceState.error || 'Device check failed')
      }

      // Step 2: Clean up other devices
      updateState({
        phase: 'checking_device',
        progress: 50,
        isRecovering: true,
        status: {
          message: 'Cleaning up other devices...',
          progress: 50
        },
        currentStep: 2,
        totalSteps: 3
      })
      if (deviceId) {
        const cleanupOk = await cleanupOtherDevices(deviceId)
        if (!cleanupOk) {
          console.warn(
            '[Recovery] Device cleanup failed, but continuing recovery'
          )
        }
      }

      // Step 3: Resume playback
      updateState({
        phase: 'resuming',
        progress: 75,
        isRecovering: true,
        status: {
          message: 'Resuming playback...',
          progress: 75
        },
        currentStep: 3,
        totalSteps: 3
      })
      const playbackOk = await resumePlayback(
        deviceId!,
        `spotify:playlist:${fixedPlaylistId}`
      )

      if (!playbackOk) {
        recordFailure()
        updateHealth('unresponsive')
        throw new Error(playbackState.error || 'Playback resume failed')
      }

      // Success
      recordSuccess()
      updateHealth('healthy')
      updateState({
        phase: 'idle',
        attempts: 0,
        error: null,
        progress: 0,
        isRecovering: false,
        status: {
          message: 'Recovery successful',
          progress: 0
        },
        currentStep: 0,
        totalSteps: 0
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      updateState({
        phase: 'error',
        attempts: state.attempts + 1,
        error: errorMessage,
        progress: 100,
        isRecovering: false,
        status: {
          message: errorMessage,
          progress: 100
        },
        currentStep: state.currentStep,
        totalSteps: state.totalSteps
      })

      // If max attempts reached, reload page
      if (state.attempts >= MAX_RECOVERY_RETRIES) {
        console.error('[Recovery] Max attempts reached, reloading page')
        setTimeout(() => {
          window.location.reload()
        }, 2000)
        return
      }

      // Schedule next attempt with exponential backoff
      const delay = BASE_DELAY * Math.pow(2, state.attempts)
      setTimeout(() => {
        void attemptRecovery()
      }, delay)
    }
  }, [
    deviceId,
    fixedPlaylistId,
    state.phase,
    state.attempts,
    deviceState.error,
    playbackState.error,
    isCircuitOpen,
    recordFailure,
    recordSuccess,
    updateHealth,
    updateState,
    checkDevice,
    resumePlayback
  ])

  // Add a reset function to manually reset the state
  const reset = useCallback(() => {
    setState({
      phase: 'idle',
      attempts: 0,
      error: null,
      progress: 0,
      isRecovering: false,
      status: {
        message: '',
        progress: 0
      },
      currentStep: 0,
      totalSteps: 0
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      updateHealth('unknown')
      reset() // Reset state on unmount
    }
  }, [updateHealth, reset])

  return {
    state,
    attemptRecovery,
    deviceState,
    playbackState,
    reset // Export reset function
  }
}
