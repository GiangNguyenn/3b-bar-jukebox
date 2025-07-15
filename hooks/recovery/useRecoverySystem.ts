import { useState, useCallback, useEffect, useRef } from 'react'
import { transferPlaybackToDevice } from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { spotifyPlayerStore } from '../useSpotifyPlayer'
import { useCircuitBreaker } from './useCircuitBreaker'
import { queueManager } from '@/services/queueManager'

// Simplified recovery system constants
export const MAX_RECOVERY_RETRIES = 3
export const BASE_DELAY = 1000 // 1 second
export const DEVICE_ACTIVATION_TIMEOUT = 10000 // 10 seconds (reduced from 15s)

// Simplified recovery state persistence
const RECOVERY_STATE_KEY = 'spotify_recovery_state'
const RECOVERY_LOCK_KEY = 'spotify_recovery_lock_ts'
const RECOVERY_LOCK_TIMEOUT = 60000 // 1 minute lock timeout

// Simplified device health status type
export type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

// Simplified recovery phases
type SimplifiedRecoveryPhase =
  | 'idle'
  | 'resetting_player' // Basic player reset
  | 'activating_device' // Simple device activation
  | 'playing_next_track' // Play next track from queue
  | 'success'
  | 'error'

export interface RecoveryState {
  phase: SimplifiedRecoveryPhase
  attempts: number
  error: string | null
  isRecovering: boolean
  message: string
  progress: number // 0 to 1
  currentStep: string
}

// Add recovery state persistence
const persistRecoveryState = (state: RecoveryState) => {
  try {
    localStorage.setItem(RECOVERY_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    // Note: This function is called outside of React context, so we can't use addLog here
  }
}

// Add recovery state restoration
const restoreRecoveryState = (): RecoveryState | null => {
  try {
    const state = localStorage.getItem(RECOVERY_STATE_KEY)
    return state ? JSON.parse(state) : null
  } catch (error) {
    return null
  }
}

export function useRecoverySystem(
  deviceId: string | null,
  playlistId: string | null, // Kept for compatibility but not used
  onHealthUpdate?: (status: { device: DeviceHealthStatus }) => void
): {
  state: RecoveryState
  recover: () => Promise<void>
  reset: () => void
} {
  const onHealthUpdateRef = useRef(onHealthUpdate)
  onHealthUpdateRef.current = onHealthUpdate

  const { addLog } = useConsoleLogsContext()

  // Use the existing circuit breaker hook
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

  // Update parent when health status changes
  useEffect(() => {
    if (onHealthUpdateRef.current) {
      onHealthUpdateRef.current({ device: deviceHealthStatusRef.current })
    }
  }, [])

  // Simplified cleanup function
  const cleanup = useCallback(async (): Promise<void> => {
    try {
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
      // Clear persisted state and lock
      localStorage.removeItem(RECOVERY_STATE_KEY)
      localStorage.removeItem(RECOVERY_LOCK_KEY)
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
      addLog(
        'INFO',
        'Recovery already in progress for this instance.',
        'RecoverySystem'
      )
      return
    }

    // Check for a global recovery lock
    const lockTimestamp = localStorage.getItem(RECOVERY_LOCK_KEY)
    if (
      lockTimestamp &&
      Date.now() - parseInt(lockTimestamp, 10) < RECOVERY_LOCK_TIMEOUT
    ) {
      addLog(
        'WARN',
        'Another recovery process is active globally. Aborting.',
        'RecoverySystem'
      )
      return
    }

    // Set a global lock
    localStorage.setItem(RECOVERY_LOCK_KEY, Date.now().toString())

    if (circuitBreaker.isCircuitOpen()) {
      // Release lock if circuit is open
      localStorage.removeItem(RECOVERY_LOCK_KEY)
      return
    }

    try {
      isRecoveringRef.current = true
      updateState({
        phase: 'resetting_player',
        attempts: state.attempts + 1,
        error: null,
        isRecovering: true,
        message: 'Starting simplified recovery process...',
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

      // Step 1: Reset Player (0% - 40%)
      updateState({
        phase: 'resetting_player',
        message: 'Resetting Spotify player...',
        progress: 0.2,
        currentStep: 'resetting_player'
      })

      // Destroy existing player
      playerLifecycleService.destroyPlayer()

      // Clear global references
      if (typeof window !== 'undefined') {
        window.spotifyPlayerInstance = null
      }

      // Reset player store state
      spotifyPlayerStore.getState().setStatus('initializing')
      spotifyPlayerStore.getState().setDeviceId(null)
      spotifyPlayerStore.getState().setPlaybackState(null)

      // Clear any cached state
      localStorage.removeItem('spotify_last_playback')

      // Step 2: Create Fresh Player (40% - 70%)
      updateState({
        phase: 'activating_device',
        message: 'Creating new Spotify player...',
        progress: 0.5,
        currentStep: 'creating_player'
      })

      // Create fresh player
      const newDeviceId = await playerLifecycleService.createPlayer(
        (status, error) => {
          spotifyPlayerStore.getState().setStatus(status as any, error)
        },
        (deviceId) => {
          spotifyPlayerStore.getState().setDeviceId(deviceId)
        },
        (state) => {
          spotifyPlayerStore.getState().setPlaybackState(state)
        }
      )

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

      // Step 3: Activate Device (70% - 90%)
      updateState({
        phase: 'activating_device',
        message: 'Activating device...',
        progress: 0.8,
        currentStep: 'activating_device'
      })

      // Transfer playback to the new device
      await transferPlaybackToDevice(currentDeviceId)

      // Step 4: Play Next Track from Database Queue (90% - 100%)
      updateState({
        phase: 'playing_next_track',
        message: 'Playing next track from queue...',
        progress: 0.9,
        currentStep: 'playing_next_track'
      })

      // Get the next track from our database queue
      const nextTrack = queueManager.getNextTrack()

      if (nextTrack) {
        const trackUri = `spotify:track:${nextTrack.tracks.spotify_track_id}`

        addLog(
          'INFO',
          `Playing next track from database queue: ${nextTrack.tracks.name}`,
          'RecoverySystem'
        )

        await sendApiRequest({
          path: 'me/player/play',
          method: 'PUT',
          body: {
            device_id: currentDeviceId,
            uris: [trackUri]
          }
        })

        addLog(
          'INFO',
          `Successfully started playing: ${nextTrack.tracks.name}`,
          'RecoverySystem'
        )
      } else {
        addLog(
          'WARN',
          'No tracks available in database queue',
          'RecoverySystem'
        )
      }

      // Success
      updateState({
        phase: 'success',
        message: 'Recovery completed successfully',
        progress: 1,
        currentStep: 'complete',
        isRecovering: false
      })
      circuitBreaker.recordSuccess()

      // Schedule cleanup after success
      recoveryTimeoutRef.current = setTimeout(() => {
        updateState({
          phase: 'idle',
          message: '',
          progress: 0,
          currentStep: '',
          isRecovering: false
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

      // Schedule cleanup after error
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
      // Release the global lock
      localStorage.removeItem(RECOVERY_LOCK_KEY)
    }
  }, [
    deviceId,
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
