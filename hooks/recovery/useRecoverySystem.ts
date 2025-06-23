import { useState, useCallback, useEffect, useRef } from 'react'
import {
  cleanupOtherDevices,
  validateDevice,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { spotifyPlayerStore } from '../useSpotifyPlayer'
import { SpotifyApiService } from '@/services/spotifyApi'
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

// Device health status type
export type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

// Updated RecoveryPhase type with logical order
type RecoveryPhase =
  | 'idle'
  | 'destroying_everything' // NEW: Complete destruction first
  | 'reloading_sdk' // NEW: Reload Spotify SDK for fresh environment
  | 'creating_player' // NEW: Fresh player creation
  | 'registering_device' // NEW: Device registration after player
  | 'restoring_playback' // NEW: Playback restoration
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
  // NEW: Track which resume strategy was used
  resumeStrategy?: 'current_state' | 'last_known' | 'fresh_start'
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
    // Note: This function is called outside of React context, so we can't use addLog here
    // The error will be handled by the calling context
  }
}

// Add recovery state restoration
const restoreRecoveryState = (): RecoveryState | null => {
  try {
    const state = localStorage.getItem(RECOVERY_STATE_KEY)
    return state ? JSON.parse(state) : null
  } catch (error) {
    // Note: This function is called outside of React context, so we can't use addLog here
    // The error will be handled by the calling context
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

  const { addLog } = useConsoleLogsContext()

  // Use the existing circuit breaker hook instead of duplicating logic
  const circuitBreaker = useCircuitBreaker(3, 30000) // threshold: 3, timeout: 30s

  // Internal device health state
  const deviceHealthStatusRef = useRef<DeviceHealthStatus>('unknown')

  // Device health functions
  const updateHealth = useCallback((status: DeviceHealthStatus) => {
    if (status !== deviceHealthStatusRef.current) {
      deviceHealthStatusRef.current = status
    }
  }, [])

  const resetHealth = useCallback(() => {
    updateHealth('unknown')
  }, [updateHealth])

  // Set up logger for player lifecycle service
  useEffect(() => {
    playerLifecycleService.setLogger(addLog)
  }, [addLog])

  const [state, setState] = useState<RecoveryState>(() => {
    // Try to restore state from persistence
    const persistedState = restoreRecoveryState()
    return (
      persistedState ?? {
        phase: 'idle',
        attempts: 0,
        error: null,
        isRecovering: false,
        message: '',
        progress: 0,
        currentStep: ''
      }
    )
  })

  const isRecoveringRef = useRef(false)
  const recoveryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update parent when health status changes (only if callback is provided)
  useEffect(() => {
    if (onHealthUpdateRef.current) {
      onHealthUpdateRef.current({ device: deviceHealthStatusRef.current })
    }
  }, [])

  // Complete cleanup function - now destroys everything
  const cleanup = useCallback(async (): Promise<void> => {
    try {
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
      resetHealth()
      // Clear persisted state
      localStorage.removeItem(RECOVERY_STATE_KEY)
    } catch (error) {
      addLog(
        'ERROR',
        'Cleanup failed:',
        'RecoverySystem',
        error instanceof Error ? error : undefined
      )
    }
  }, [resetHealth, addLog])

  const reset = useCallback((): void => {
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current)
      recoveryTimeoutRef.current = null
    }
    circuitBreaker.reset()
    void cleanup()
  }, [circuitBreaker.reset, cleanup])

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
      return
    }

    if (circuitBreaker.isCircuitOpen()) {
      return
    }

    try {
      isRecoveringRef.current = true
      updateState({
        phase: 'destroying_everything',
        attempts: state.attempts + 1,
        error: null,
        isRecovering: true,
        message: 'Starting recovery process...',
        progress: 0,
        currentStep: 'initializing'
      })

      // Check if we've exceeded max retries
      if (state.attempts >= MAX_RECOVERY_RETRIES) {
        addLog(
          'ERROR',
          'Max recovery attempts reached, performing full reset',
          'RecoverySystem'
        )
        await cleanup()
        reset()
        return
      }

      // Step 1: Complete Destruction (0% - 30%)
      updateState({
        phase: 'destroying_everything',
        message: 'Destroying existing player and clearing state...',
        progress: 0.15,
        currentStep: 'destroying_player'
      })

      // Destroy existing player completely
      playerLifecycleService.destroyPlayer()

      // Clear global references
      if (typeof window !== 'undefined') {
        window.spotifyPlayerInstance = null
      }

      // Reset player store state
      spotifyPlayerStore.getState().setStatus('initializing')
      spotifyPlayerStore.getState().setDeviceId(null)
      spotifyPlayerStore.getState().setPlaybackState(null)

      // Clear any cached state that might be corrupted
      localStorage.removeItem('spotify_last_playback')

      // Step 2: Reload Spotify SDK (30% - 40%)
      updateState({
        phase: 'reloading_sdk',
        message: 'Reloading Spotify SDK...',
        progress: 0.4,
        currentStep: 'reloading_sdk'
      })

      // Reload Spotify SDK
      await playerLifecycleService.reloadSDK()

      // Step 3: Fresh Player Creation (40% - 60%)
      updateState({
        phase: 'creating_player',
        message: 'Creating new Spotify player...',
        progress: 0.6,
        currentStep: 'creating_player'
      })

      // Create fresh player
      const newDeviceId = await playerLifecycleService.createPlayer(
        (status, error) => {
          // Removed INFO log as per user request
        },
        (deviceId) => {
          // Removed INFO log as per user request
        },
        (state) => {
          // Removed INFO log as per user request
        }
      )

      // createPlayer returns null on success - the device ID comes from the 'ready' event
      // Wait a moment for the player to initialize and get the device ID from the store
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const currentDeviceId = spotifyPlayerStore.getState().deviceId
      const currentStatus = spotifyPlayerStore.getState().status

      if (!currentDeviceId || currentStatus !== 'ready') {
        addLog(
          'ERROR',
          `Player creation failed. Status: ${currentStatus}, Device ID: ${currentDeviceId}`,
          'RecoverySystem'
        )
        throw new Error('Failed to create new player')
      }

      // Step 4: Device Registration (60% - 80%)
      updateState({
        phase: 'registering_device',
        message: 'Registering device with Spotify...',
        progress: 0.8,
        currentStep: 'registering_device'
      })

      // Wait for device to appear in Spotify's device list
      const deviceRegistered = await waitForDevice(
        currentDeviceId,
        DEVICE_REGISTRATION_TIMEOUT
      )
      if (!deviceRegistered) {
        throw new Error('Device registration timeout')
      }

      // Transfer playback to the new device
      await transferPlaybackToDevice(currentDeviceId)

      // Wait for device to become active
      const deviceActive = await waitForDeviceActive(
        currentDeviceId,
        DEVICE_ACTIVATION_TIMEOUT
      )
      if (!deviceActive) {
        throw new Error('Device activation timeout')
      }

      // Step 5: Playback Restoration (80% - 100%)
      updateState({
        phase: 'restoring_playback',
        message: 'Restoring playback from last position...',
        progress: 1,
        currentStep: 'restoring_playback'
      })

      // Use SpotifyApiService to restore from last position
      const spotifyApi = SpotifyApiService.getInstance()
      const resumeResult = await spotifyApi.resumePlayback()

      if (!resumeResult.success) {
        throw new Error('Failed to restore playback')
      }

      // Determine which resume strategy was used
      let resumeStrategy: 'current_state' | 'last_known' | 'fresh_start' =
        'fresh_start'
      if (resumeResult.resumedFrom) {
        resumeStrategy = 'current_state'
      }

      // Removed INFO log as per user request

      // Success
      updateState({
        phase: 'success',
        message: 'Recovery completed successfully',
        progress: 1,
        currentStep: 'complete',
        isRecovering: false,
        resumeStrategy
      })
      circuitBreaker.recordSuccess()

      // Schedule cleanup after success to clear the success message
      recoveryTimeoutRef.current = setTimeout(() => {
        updateState({
          phase: 'idle',
          message: '',
          progress: 0,
          currentStep: '',
          isRecovering: false,
          resumeStrategy: undefined
        })
      }, 3000) // Clear after 3 seconds
    } catch (error) {
      addLog(
        'ERROR',
        'Recovery failed:',
        'RecoverySystem',
        error instanceof Error ? error : undefined
      )
      circuitBreaker.recordFailure()
      updateState({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Recovery failed',
        progress: 0,
        currentStep: 'error',
        isRecovering: false
      })

      // Schedule cleanup after error to clear the error message
      recoveryTimeoutRef.current = setTimeout(() => {
        updateState({
          phase: 'idle',
          message: '',
          progress: 0,
          currentStep: '',
          isRecovering: false,
          error: null
        })
      }, 5000) // Clear after 5 seconds for errors
    } finally {
      isRecoveringRef.current = false
    }
  }, [
    deviceId,
    playlistId,
    state.attempts,
    updateState,
    circuitBreaker.recordSuccess,
    circuitBreaker.recordFailure,
    circuitBreaker.isCircuitOpen,
    reset,
    addLog
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
