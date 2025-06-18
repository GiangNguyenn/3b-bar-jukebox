import { useState, useCallback, useEffect, useRef } from 'react'
import { usePlaybackManager } from './usePlaybackManager'
import { useDeviceHealth, DeviceHealthStatus } from './useDeviceHealth'
import {
  cleanupOtherDevices,
  verifyDeviceTransfer,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { useSpotifyPlayerHook } from '../useSpotifyPlayer'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { useCircuitBreaker } from './useCircuitBreaker'

// Recovery system constants
export const MAX_RECOVERY_RETRIES = 3
export const BASE_DELAY = 1000 // 1 second
export const STALL_THRESHOLD = 5000 // 5 seconds
export const STALL_CHECK_INTERVAL = 2000 // Check every 2 seconds
export const MIN_STALLS_BEFORE_RECOVERY = 2 // Require only 2 stalls
export const PROGRESS_TOLERANCE = 100 // Allow 100ms difference in progress

// Add recovery state persistence
const RECOVERY_STATE_KEY = 'spotify_recovery_state'
const DEVICE_REGISTRATION_TIMEOUT = 15000 // 15 seconds
const DEVICE_ACTIVATION_TIMEOUT = 15000 // 15 seconds

// Update RecoveryPhase type to include all possible phases
type RecoveryPhase =
  | 'idle'
  | 'starting'
  | 'device_check'
  | 'device_registration'
  | 'device_activation'
  | 'playback_resume'
  | 'success'
  | 'error'

export interface RecoveryState {
  phase: RecoveryPhase
  attempts: number
  error: string | null
  isRecovering: boolean
  message: string
  progress: number // 0 to 1
  currentStep: string
  lastStallCheck?: {
    timestamp: number
    count: number
  }
}

// Add helper to poll for device registration
async function waitForDevice(
  deviceId: string,
  timeoutMs = 10000
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const devices = await sendApiRequest<{ devices: { id: string }[] }>({
      path: 'me/player/devices',
      method: 'GET'
    })
    if (devices.devices.some((d: { id: string }) => d.id === deviceId)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

// Add helper to poll for device active
async function waitForDeviceActive(
  deviceId: string,
  timeoutMs = 10000
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const devices = await sendApiRequest<{
      devices: { id: string; is_active: boolean }[]
    }>({
      path: 'me/player/devices',
      method: 'GET'
    })
    if (devices.devices.some((d) => d.id === deviceId && d.is_active)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

// Add recovery state persistence
const persistRecoveryState = (state: RecoveryState) => {
  try {
    localStorage.setItem(RECOVERY_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('Failed to persist recovery state:', error)
  }
}

// Add recovery state restoration
const restoreRecoveryState = (): RecoveryState | null => {
  try {
    const state = localStorage.getItem(RECOVERY_STATE_KEY)
    return state ? JSON.parse(state) : null
  } catch (error) {
    console.error('Failed to restore recovery state:', error)
    return null
  }
}

export function useRecoverySystem(
  deviceId: string | null,
  playlistId: string | null,
  onHealthUpdate?: (status: { device: DeviceHealthStatus }) => void
): {
  state: RecoveryState
  recover: () => Promise<void>
  reset: () => void
} {
  const onHealthUpdateRef = useRef(onHealthUpdate)
  onHealthUpdateRef.current = onHealthUpdate

  const { updateHealth, currentStatus } = useDeviceHealth()
  const { state: playbackState, resumePlayback, reset: resetPlayback } = usePlaybackManager(playlistId)
  const { isCircuitOpen, recordFailure, recordSuccess, reset: resetCircuit } = useCircuitBreaker(3, 30000)
  const { destroyPlayer, createPlayer } = useSpotifyPlayerHook()

  const [state, setState] = useState<RecoveryState>(() => {
    // Try to restore state from persistence
    const persistedState = restoreRecoveryState()
    return persistedState ?? {
      phase: 'idle',
      attempts: 0,
      error: null,
      isRecovering: false,
      message: '',
      progress: 0,
      currentStep: ''
    }
  })

  const isRecoveringRef = useRef(false)
  const recoveryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update parent when health status changes (only if callback is provided)
  useEffect(() => {
    if (onHealthUpdateRef.current) {
      onHealthUpdateRef.current({ device: currentStatus })
    }
  }, [currentStatus])

  // Add proper cleanup function
  const cleanup = useCallback(async (): Promise<void> => {
    try {
      await destroyPlayer()
      // Reset all states
      setState({
        phase: 'idle',
        attempts: 0,
        error: null,
        isRecovering: false,
        message: '',
        progress: 0,
        currentStep: ''
      })
      updateHealth('unknown')
      // Clear persisted state
      localStorage.removeItem(RECOVERY_STATE_KEY)
    } catch (error) {
      console.error('Cleanup failed:', error)
    }
  }, [destroyPlayer, updateHealth])

  const reset = useCallback((): void => {
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current)
      recoveryTimeoutRef.current = null
    }
    resetPlayback()
    resetCircuit()
    void cleanup()
  }, [resetPlayback, resetCircuit, cleanup])

  // Update state with persistence
  const updateState = useCallback((newState: Partial<RecoveryState>): void => {
    setState((prev) => {
      const updated = { ...prev, ...newState }
      persistRecoveryState(updated)
      return updated
    })
  }, [])

  const recover = useCallback(async (): Promise<void> => {
    if (isRecoveringRef.current) {
      console.log('[Recovery] Recovery already in progress')
      return
    }

    if (isCircuitOpen()) {
      console.log('[Recovery] Circuit breaker is open, skipping recovery')
      return
    }

    try {
      isRecoveringRef.current = true
      updateState({
        phase: 'starting',
        attempts: state.attempts + 1,
        error: null,
        isRecovering: true,
        message: 'Starting recovery process...',
        progress: 0,
        currentStep: 'initializing'
      })

      // Check if we've exceeded max retries
      if (state.attempts >= MAX_RECOVERY_RETRIES) {
        console.error('[Recovery] Max recovery attempts reached, performing full reset')
        await cleanup()
        // Instead of reloading, perform a full reset
        reset()
        return
      }

      // Step 1: Check device
      updateState({
        phase: 'device_check',
        message: 'Checking device status...',
        progress: 0.2,
        currentStep: 'device_check'
      })

      const deviceOk = await verifyDeviceTransfer(deviceId ?? '')
      if (!deviceOk) {
        throw new Error('Device check failed')
      }

      // Step 2: Wait for device registration with increased timeout
      updateState({
        phase: 'device_registration',
        message: 'Waiting for device registration...',
        progress: 0.4,
        currentStep: 'device_registration'
      })

      const found = await waitForDevice(deviceId ?? '', DEVICE_REGISTRATION_TIMEOUT)
      if (!found) {
        throw new Error('Device registration timeout')
      }

      // Step 3: Wait for device activation with increased timeout
      updateState({
        phase: 'device_activation',
        message: 'Waiting for device activation...',
        progress: 0.6,
        currentStep: 'device_activation'
      })

      const activated = await waitForDeviceActive(deviceId ?? '', DEVICE_ACTIVATION_TIMEOUT)
      if (!activated) {
        throw new Error('Device activation timeout')
      }

      // Step 4: Resume playback
      updateState({
        phase: 'playback_resume',
        message: 'Resuming playback...',
        progress: 0.8,
        currentStep: 'playback_resume'
      })

      const playbackOk = await resumePlayback(deviceId ?? '', `spotify:playlist:${playlistId}`)
      if (!playbackOk) {
        throw new Error('Playback resume failed')
      }

      // Success
      updateState({
        phase: 'success',
        message: 'Recovery completed successfully',
        progress: 1,
        currentStep: 'complete'
      })
      recordSuccess()

      // Schedule cleanup after success
      recoveryTimeoutRef.current = setTimeout(() => {
        reset()
      }, 5000)

    } catch (error) {
      console.error('[Recovery] Recovery failed:', error)
      recordFailure()
      updateState({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Recovery failed',
        progress: 0,
        currentStep: 'error'
      })

      // Schedule cleanup after error
      recoveryTimeoutRef.current = setTimeout(() => {
        reset()
      }, 5000)

    } finally {
      isRecoveringRef.current = false
    }
  }, [
    deviceId,
    playlistId,
    state.attempts,
    updateState,
    verifyDeviceTransfer,
    resumePlayback,
    recordSuccess,
    recordFailure,
    reset
  ])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recoveryTimeoutRef.current) {
        clearTimeout(recoveryTimeoutRef.current)
      }
      cleanup()
    }
  }, [])

  return {
    state,
    recover,
    reset
  }
}
