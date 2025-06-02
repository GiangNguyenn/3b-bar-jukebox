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
      Sentry.logger.warn('Recovery attempt while already recovering', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        attempts: state.attempts
      })
      return
    }
    isRecoveringRef.current = true
    // Log a warning with Sentry when recovery starts
    Sentry.logger.warn('Recovery started', {
      deviceId,
      fixedPlaylistId,
      timestamp: new Date().toISOString(),
      attempts: state.attempts
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
      Sentry.logger.warn('Destroying player', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Destroying player'
      })
      await destroyPlayer()

      // Step 2: Create new player with random name
      updateState({
        progress: 0.15,
        currentStep: 'Creating new player',
        message: 'Creating new player with random name...'
      })
      Sentry.logger.warn('Creating new player', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Creating new player'
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
      Sentry.logger.warn('Waiting for new player registration', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Waiting for new player registration'
      })
      const found = await waitForDevice(newDeviceId, 10000)
      if (!found) {
        Sentry.logger.error('New device did not register in time', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Wait for device registration'
        })
        throw new Error('New device did not register in time')
      }

      // Step 3.5: Activate device, etc. (use newDeviceId from here on)
      updateState({
        progress: 0.3,
        currentStep: 'Activating device',
        message: 'Transferring playback to new device...'
      })
      Sentry.logger.warn('Transferring playback to new device', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Transferring playback'
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
      Sentry.logger.warn('Waiting for device to become active', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Wait for device active'
      })
      const active = await waitForDeviceActive(newDeviceId, 10000)
      if (!active) {
        Sentry.logger.error('Device did not become active in time', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Wait for device active'
        })
        throw new Error('Device did not become active in time')
      }
      // Step 4: Clean up other devices
      updateState({
        progress: 0.65,
        currentStep: 'Cleaning up other devices',
        message: 'Cleaning up other devices...'
      })
      Sentry.logger.warn('Cleaning up other devices', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Cleaning up other devices'
      })
      if (newDeviceId) {
        let cleanupAttempts = 0
        let cleanupOk = false
        while (!cleanupOk && cleanupAttempts < 3) {
          cleanupOk = await cleanupOtherDevices(newDeviceId)
          if (!cleanupOk) {
            cleanupAttempts++
            Sentry.logger.warn('Device cleanup attempt failed', {
              deviceId: newDeviceId,
              fixedPlaylistId,
              timestamp: new Date().toISOString(),
              step: 'Device cleanup',
              attempt: cleanupAttempts
            })
            if (cleanupAttempts < 3) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }
        if (!cleanupOk) {
          Sentry.logger.error(
            'Failed to clean up other devices after multiple attempts',
            {
              deviceId: newDeviceId,
              fixedPlaylistId,
              timestamp: new Date().toISOString(),
              step: 'Device cleanup',
              attempts: cleanupAttempts
            }
          )
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
      Sentry.logger.warn('Verifying device transfer', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Verifying device transfer'
      })
      const transferOk = newDeviceId
        ? await verifyDeviceTransfer(newDeviceId)
        : false
      if (!transferOk) {
        Sentry.logger.error('Device transfer verification failed', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Verify device transfer'
        })
        throw new Error('Device transfer verification failed')
      }
      // Step 6: Resume playback
      updateState({
        progress: 0.9,
        currentStep: 'Resuming playback',
        message: 'Resuming playback...'
      })
      Sentry.logger.warn('Resuming playback', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Resuming playback'
      })
      const playbackOk =
        newDeviceId && fixedPlaylistId
          ? await resumePlayback(
              newDeviceId,
              `spotify:playlist:${fixedPlaylistId}`
            )
          : false
      if (!playbackOk) {
        Sentry.logger.error('Playback resume failed', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Resume playback'
        })
        throw new Error('Playback resume failed')
      }
      // Step 7: Verify recovery success
      updateState({
        progress: 0.95,
        currentStep: 'Verifying recovery',
        message: 'Verifying recovery...'
      })
      Sentry.logger.warn('Verifying recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Verifying recovery'
      })
      const finalDeviceCheck = await checkDevice()
      if (!finalDeviceCheck) {
        // Gather more detailed device state for error reporting
        let deviceStateDetails = null
        try {
          const devices = await sendApiRequest<{ devices: any[] }>({
            path: 'me/player/devices',
            method: 'GET'
          })
          deviceStateDetails = devices
        } catch (err) {
          deviceStateDetails = {
            error: err instanceof Error ? err.message : String(err)
          }
        }
        Sentry.logger.error('Final device check failed after recovery', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Final device check',
          deviceStateDetails
        })
        // If the device is present and active, consider this a soft warning, not a hard failure
        if (
          deviceStateDetails &&
          Array.isArray(deviceStateDetails.devices) &&
          deviceStateDetails.devices.some(
            (d) => d.id === newDeviceId && d.is_active
          )
        ) {
          Sentry.logger.warn(
            'Device is present and active despite checkDevice() failure',
            {
              deviceId: newDeviceId,
              fixedPlaylistId,
              timestamp: new Date().toISOString(),
              step: 'Final device check',
              deviceStateDetails
            }
          )
        } else {
          throw new Error(
            `Final device check failed after recovery. Device state: ${JSON.stringify(deviceStateDetails)}`
          )
        }
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
      Sentry.logger.warn('Full recovery successful', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Success'
      })
      // Always log to Sentry that the final recovery process was successful
      Sentry.logger.warn('Recovery process completed: SUCCESS', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Final recovery',
        attempts: state.attempts
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
        error: error instanceof Error ? error.message : String(error),
        deviceId,
        fixedPlaylistId,
        step: state.currentStep,
        timestamp: new Date().toISOString(),
        attempts: state.attempts + 1
      })
      // Always log to Sentry that the final recovery process was a failure
      Sentry.logger.error('Recovery process completed: FAILURE', {
        error: error instanceof Error ? error.message : String(error),
        deviceId,
        fixedPlaylistId,
        step: 'Final recovery',
        timestamp: new Date().toISOString(),
        attempts: state.attempts + 1
      })
      // Optionally retry or reload page if needed
      if (state.attempts + 1 >= MAX_RECOVERY_RETRIES) {
        Sentry.logger.error('Max recovery attempts reached, reloading page', {
          deviceId,
          fixedPlaylistId,
          step: state.currentStep,
          timestamp: new Date().toISOString(),
          attempts: state.attempts + 1
        })
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
