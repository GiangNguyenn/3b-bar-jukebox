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
      // Step 1: Device Check with detailed error handling
      console.log('[Recovery] Checking device status...')
      const deviceOk = await checkDevice()
      if (!deviceOk) {
        throw new Error(
          `Device check failed: ${deviceState.error || 'Unknown error'}`
        )
      }

      // Step 2: Clean up other devices with retry
      if (deviceId) {
        console.log('[Recovery] Cleaning up other devices...')
        let cleanupAttempts = 0
        let cleanupOk = false

        while (!cleanupOk && cleanupAttempts < 3) {
          cleanupOk = await cleanupOtherDevices(deviceId)
          if (!cleanupOk) {
            cleanupAttempts++
            if (cleanupAttempts < 3) {
              console.warn(
                `[Recovery] Device cleanup attempt ${cleanupAttempts} failed, retrying...`
              )
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }

        if (!cleanupOk) {
          throw new Error(
            'Failed to clean up other devices after multiple attempts'
          )
        }
      }

      // Step 3: Verify device transfer
      console.log('[Recovery] Verifying device transfer...')
      const transferOk = await verifyDeviceTransfer(deviceId!)
      if (!transferOk) {
        throw new Error('Device transfer verification failed')
      }

      // Step 4: Resume playback with verification
      console.log('[Recovery] Resuming playback...')
      const playbackOk = await resumePlayback(
        deviceId!,
        `spotify:playlist:${fixedPlaylistId}`
      )
      if (!playbackOk) {
        throw new Error(
          `Playback resume failed: ${playbackState.error || 'Unknown error'}`
        )
      }

      // Step 5: Verify recovery success
      console.log('[Recovery] Verifying recovery success...')
      const finalDeviceCheck = await checkDevice()
      if (!finalDeviceCheck) {
        throw new Error('Final device check failed after recovery')
      }

      // Success with verification
      updateHealth('healthy')
      updateState({
        phase: 'success',
        attempts: 0,
        error: null,
        isRecovering: false,
        message: 'Recovery successful and verified',
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

      console.error('[Recovery] Recovery attempt failed:', {
        error: errorMessage,
        attempt: newAttempts,
        maxAttempts: MAX_RECOVERY_RETRIES
      })

      updateState({
        phase: 'error',
        attempts: newAttempts,
        error: errorMessage,
        isRecovering: false,
        message: `Recovery failed: ${errorMessage}`
      })

      // Handle max attempts
      if (newAttempts >= MAX_RECOVERY_RETRIES) {
        console.error('[Recovery] Max attempts reached, reloading page')
        window.location.reload()
        return
      }

      // Schedule next attempt with exponential backoff
      const delay = BASE_DELAY * Math.pow(2, newAttempts)
      console.log(`[Recovery] Scheduling next attempt in ${delay}ms`)
      setTimeout(() => {
        void attemptRecovery()
      }, delay)
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
