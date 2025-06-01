import { useState, useCallback, useEffect, useRef } from 'react'
import { useDeviceManager } from './useDeviceManager'
import { usePlaybackManager } from './usePlaybackManager'
import { useHealthStatus, DeviceHealthStatus } from './useHealthStatus'
import {
  cleanupOtherDevices,
  verifyDeviceTransfer
} from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import {
  destroyPlayer,
  createPlayer,
  useSpotifyPlayer
} from '../useSpotifyPlayer'
import * as Sentry from '@sentry/nextjs'

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

export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onHealthStatusUpdate: (status: { device: DeviceHealthStatus }) => void,
  isInitializing: boolean = false,
  onSuccess?: () => void
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
    progress: 0,
    currentStep: '',
    lastStallCheck: { timestamp: 0, count: 0 }
  })

  const isRecoveringRef = useRef(false)

  const updateState = useCallback((updates: Partial<RecoveryState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }, [])

  const recover = useCallback(async (): Promise<void> => {
    if (state.isRecovering || isRecoveringRef.current) {
      // Already recovering, do not start another
      return
    }
    isRecoveringRef.current = true
    // Log a warning with Sentry when recovery starts
    Sentry.logger.warn('Recovery started', {
      deviceId,
      fixedPlaylistId,
      timestamp: new Date().toISOString()
    })
    updateState({
      phase: 'recovering',
      isRecovering: true,
      message: 'Starting full recovery...',
      progress: 0,
      currentStep: 'Starting',
      attempts: 0,
      error: null
    })
    try {
      // Step 1: Destroy player
      updateState({
        progress: 0.05,
        currentStep: 'Destroying player',
        message: 'Destroying current player...'
      })
      await destroyPlayer()

      // Step 2: Create new player with random name
      updateState({
        progress: 0.15,
        currentStep: 'Creating new player',
        message: 'Creating new player with random name...'
      })
      const newDeviceId = await createPlayer()
      // Propagate new device ID to Zustand store
      const setDeviceId = useSpotifyPlayer.getState().setDeviceId
      setDeviceId(newDeviceId)

      // Step 3: Wait for new player registration
      updateState({
        progress: 0.25,
        currentStep: 'Waiting for new player registration',
        message: 'Waiting for new player to register...'
      })
      const found = await waitForDevice(newDeviceId, 10000)
      if (!found) throw new Error('New device did not register in time')

      // Step 3.5: Activate device, etc. (use newDeviceId from here on)
      updateState({
        progress: 0.3,
        currentStep: 'Activating device',
        message: 'Transferring playback to new device...'
      })
      await sendApiRequest({
        path: 'me/player',
        method: 'PUT',
        body: {
          device_ids: [newDeviceId],
          play: false
        }
      })
      // Step 3.6: Wait for device to become active
      updateState({
        progress: 0.6,
        currentStep: 'Waiting for device to become active',
        message: 'Waiting for device to become active...'
      })
      const active = await waitForDeviceActive(newDeviceId, 10000)
      if (!active) {
        throw new Error('Device did not become active in time')
      }
      // Step 4: Clean up other devices
      updateState({
        progress: 0.65,
        currentStep: 'Cleaning up other devices',
        message: 'Cleaning up other devices...'
      })
      if (newDeviceId) {
        let cleanupAttempts = 0
        let cleanupOk = false
        while (!cleanupOk && cleanupAttempts < 3) {
          cleanupOk = await cleanupOtherDevices(newDeviceId)
          if (!cleanupOk) {
            cleanupAttempts++
            if (cleanupAttempts < 3) {
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
      // Step 5: Verify device transfer
      updateState({
        progress: 0.8,
        currentStep: 'Verifying device transfer',
        message: 'Verifying device transfer...'
      })
      const transferOk = newDeviceId
        ? await verifyDeviceTransfer(newDeviceId)
        : false
      if (!transferOk) {
        throw new Error('Device transfer verification failed')
      }
      // Step 6: Resume playback
      updateState({
        progress: 0.9,
        currentStep: 'Resuming playback',
        message: 'Resuming playback...'
      })
      const playbackOk =
        newDeviceId && fixedPlaylistId
          ? await resumePlayback(
              newDeviceId,
              `spotify:playlist:${fixedPlaylistId}`
            )
          : false
      if (!playbackOk) {
        throw new Error('Playback resume failed')
      }
      // Step 7: Verify recovery success
      updateState({
        progress: 0.95,
        currentStep: 'Verifying recovery',
        message: 'Verifying recovery...'
      })
      const finalDeviceCheck = await checkDevice()
      if (!finalDeviceCheck) {
        throw new Error('Final device check failed after recovery')
      }
      // Step 8: Update health and state
      updateHealth('healthy')
      if (onSuccess) onSuccess()
      updateState({
        phase: 'success',
        attempts: 0,
        error: null,
        isRecovering: false,
        message: 'Full recovery successful',
        progress: 1,
        currentStep: 'Success',
        lastStallCheck: { timestamp: 0, count: 0 }
      })
      setTimeout(() => {
        updateState({
          phase: 'idle',
          message: '',
          progress: 0,
          currentStep: ''
        })
      }, 2000)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      updateState({
        phase: 'error',
        attempts: state.attempts + 1,
        error: errorMessage,
        isRecovering: false,
        message: `Full recovery failed: ${errorMessage}`,
        progress: 1,
        currentStep: 'Error'
      })
      // Log an error with Sentry if an error is thrown
      Sentry.logger.error('Recovery failed', {
        error: error instanceof Error ? error.message : error,
        deviceId,
        fixedPlaylistId,
        step: state.currentStep,
        timestamp: new Date().toISOString()
      })
      // Optionally retry or reload page if needed
      if (state.attempts + 1 >= MAX_RECOVERY_RETRIES) {
        window.location.reload()
      }
    } finally {
      isRecoveringRef.current = false
    }
  }, [
    state.isRecovering,
    deviceId,
    fixedPlaylistId,
    state.attempts,
    updateHealth,
    updateState,
    checkDevice,
    resumePlayback,
    onSuccess
  ])

  // Add a reset function to manually reset the state
  const reset = useCallback(() => {
    setState({
      phase: 'idle',
      attempts: 0,
      error: null,
      isRecovering: false,
      message: '',
      progress: 0,
      currentStep: '',
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
    recover,
    deviceState,
    playbackState,
    reset
  }
}
