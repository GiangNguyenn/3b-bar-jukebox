import { useState, useCallback, useEffect, useRef } from 'react'
import { useDeviceManager } from './useDeviceManager'
import { usePlaybackManager } from './usePlaybackManager'
import { useHealthStatus, DeviceHealthStatus } from './useHealthStatus'
import {
  cleanupOtherDevices,
  verifyDeviceTransfer,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import {
  destroyPlayer,
  createPlayer,
  useSpotifyPlayer
} from '../useSpotifyPlayer'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'

// Recovery system constants
export const MAX_RECOVERY_RETRIES = 5
export const BASE_DELAY = 1000 // 1 second
export const STALL_THRESHOLD = 5000 // 5 seconds
export const STALL_CHECK_INTERVAL = 2000 // Check every 2 seconds
export const MIN_STALLS_BEFORE_RECOVERY = 2 // Require only 2 stalls
export const PROGRESS_TOLERANCE = 100 // Allow 100ms difference in progress

type RecoveryPhase = 'idle' | 'recovering' | 'success' | 'error'

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
  const { addLog } = useConsoleLogsContext()

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
      addLog('WARN', 'Recovery attempt while already recovering', 'Recovery', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        attempts: state.attempts
      } as any)
      return
    }
    isRecoveringRef.current = true
    // Log a warning when recovery starts
    addLog('WARN', 'Recovery started', 'Recovery', {
      deviceId,
      fixedPlaylistId,
      timestamp: new Date().toISOString(),
      attempts: state.attempts
    } as any)
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
      addLog('WARN', 'Destroying player', 'Recovery', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Destroying player'
      } as any)
      await destroyPlayer()

      // Step 2: Create new player with random name
      updateState({
        progress: 0.15,
        currentStep: 'Creating new player',
        message: 'Creating new player with random name...'
      })
      addLog('WARN', 'Creating new player', 'Recovery', {
        deviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Creating new player'
      } as any)
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
      addLog('WARN', 'Waiting for new player registration', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Waiting for new player registration'
      } as any)
      const found = await waitForDevice(newDeviceId, 10000)
      if (!found) {
        addLog('ERROR', 'New device did not register in time', 'Recovery', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Wait for device registration'
        } as any)
        throw new Error('New device did not register in time')
      }

      // Step 3.5: Activate device, etc. (use newDeviceId from here on)
      updateState({
        progress: 0.3,
        currentStep: 'Activating device',
        message: 'Transferring playback to new device...'
      })
      addLog('WARN', 'Transferring playback to new device', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Transferring playback'
      } as any)
      const transferSuccess = await transferPlaybackToDevice(newDeviceId)
      if (!transferSuccess) {
        throw new Error('Failed to transfer playback to new device')
      }

      // Step 3.6: Wait for device to become active
      updateState({
        progress: 0.6,
        currentStep: 'Waiting for device to become active',
        message: 'Waiting for device to become active...'
      })
      addLog('WARN', 'Waiting for device to become active', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Wait for device active'
      } as any)
      const active = await waitForDeviceActive(newDeviceId, 10000)
      if (!active) {
        addLog('ERROR', 'Device did not become active in time', 'Recovery', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Wait for device active'
        } as any)
        throw new Error('Device did not become active in time')
      }

      // Step 4: Clean up other devices
      updateState({
        progress: 0.65,
        currentStep: 'Cleaning up other devices',
        message: 'Cleaning up other devices...'
      })
      addLog('WARN', 'Cleaning up other devices', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Cleaning up other devices'
      } as any)
      if (newDeviceId) {
        let cleanupAttempts = 0
        let cleanupOk = false
        while (!cleanupOk && cleanupAttempts < 3) {
          cleanupOk = await cleanupOtherDevices(newDeviceId)
          if (!cleanupOk) {
            cleanupAttempts++
            addLog('WARN', 'Device cleanup attempt failed', 'Recovery', {
              deviceId: newDeviceId,
              fixedPlaylistId,
              timestamp: new Date().toISOString(),
              step: 'Device cleanup',
              attempt: cleanupAttempts
            } as any)
            if (cleanupAttempts < 3) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }
        if (!cleanupOk) {
          addLog('ERROR', 'Failed to clean up other devices after multiple attempts', 'Recovery', {
              deviceId: newDeviceId,
              fixedPlaylistId,
              timestamp: new Date().toISOString(),
              step: 'Device cleanup',
              attempts: cleanupAttempts
          } as any)
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
      addLog('WARN', 'Verifying device transfer', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Verifying device transfer'
      } as any)
      const transferOk = newDeviceId
        ? await verifyDeviceTransfer(newDeviceId)
        : false
      if (!transferOk) {
        addLog('ERROR', 'Device transfer verification failed', 'Recovery', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Verify device transfer'
        } as any)
        throw new Error('Device transfer verification failed')
      }

      // Step 6: Resume playback
      updateState({
        progress: 0.9,
        currentStep: 'Resuming playback',
        message: 'Resuming playback...'
      })
      addLog('WARN', 'Resuming playback', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Resuming playback'
      } as any)
      const playbackOk =
        newDeviceId && fixedPlaylistId
          ? await resumePlayback(
              newDeviceId,
              `spotify:playlist:${fixedPlaylistId}`
            )
          : false
      if (!playbackOk) {
        addLog('ERROR', 'Playback resume failed', 'Recovery', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Resume playback'
        } as any)
        throw new Error('Playback resume failed')
      }

      // Step 7: Verify recovery success
      updateState({
        progress: 0.95,
        currentStep: 'Verifying recovery',
        message: 'Verifying recovery...'
      })
      addLog('WARN', 'Verifying recovery', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Verifying recovery'
      } as any)
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
        addLog('ERROR', 'Final device check failed after recovery', 'Recovery', {
          deviceId: newDeviceId,
          fixedPlaylistId,
          timestamp: new Date().toISOString(),
          step: 'Final device check',
          deviceStateDetails
        } as any)
        // If the device is present and active, consider this a soft warning, not a hard failure
        if (
          deviceStateDetails &&
          Array.isArray(deviceStateDetails.devices) &&
          deviceStateDetails.devices.some(
            (d) => d.id === newDeviceId && d.is_active
          )
        ) {
          addLog('WARN', 'Device is present and active despite checkDevice() failure', 'Recovery', {
              deviceId: newDeviceId,
              fixedPlaylistId,
              timestamp: new Date().toISOString(),
              step: 'Final device check',
              deviceStateDetails
          } as any)
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
      addLog('WARN', 'Full recovery successful', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Success'
      } as any)
      // Always log that the final recovery process was successful
      addLog('WARN', 'Recovery process completed: SUCCESS', 'Recovery', {
        deviceId: newDeviceId,
        fixedPlaylistId,
        timestamp: new Date().toISOString(),
        step: 'Final recovery',
        attempts: state.attempts
      } as any)
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
      // Log an error if an error is thrown
      addLog('ERROR', 'Recovery failed', 'Recovery', {
        error: error instanceof Error ? error.message : String(error),
        deviceId,
        fixedPlaylistId,
        step: state.currentStep,
        timestamp: new Date().toISOString(),
        attempts: state.attempts + 1
      } as any)
      // Always log that the final recovery process was a failure
      addLog('ERROR', 'Recovery process completed: FAILURE', 'Recovery', {
        error: error instanceof Error ? error.message : String(error),
        deviceId,
        fixedPlaylistId,
        step: 'Final recovery',
        timestamp: new Date().toISOString(),
        attempts: state.attempts + 1
      } as any)
      // Optionally retry or reload page if needed
      if (state.attempts + 1 >= MAX_RECOVERY_RETRIES) {
        addLog('ERROR', 'Max recovery attempts reached, reloading page', 'Recovery', {
          deviceId,
          fixedPlaylistId,
          step: state.currentStep,
          timestamp: new Date().toISOString(),
          attempts: state.attempts + 1
        } as any)
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
    onSuccess,
    addLog
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
