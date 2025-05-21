import { useState, useCallback, useRef, useEffect } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, HealthStatus } from '@/shared/types'
import {
  RecoveryState,
  RecoveryStatus,
  ValidationResult,
  RecoverySystemHook,
  ErrorType
} from '@/shared/types/recovery'
import {
  verifyDeviceTransfer,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import {
  RECOVERY_COOLDOWN,
  RECOVERY_STEPS,
  ERROR_MESSAGES
} from '@/shared/constants/recovery'

function determineErrorType(error: unknown): ErrorType {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('token') ||
      message.includes('auth') ||
      message.includes('unauthorized')
    ) {
      return ErrorType.AUTH
    }
    if (message.includes('device') || message.includes('transfer')) {
      return ErrorType.DEVICE
    }
    if (
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('timeout')
    ) {
      return ErrorType.CONNECTION
    }
  }
  return ErrorType.PLAYBACK
}

function createRecoveryStatus(): RecoveryStatus {
  return {
    isRecovering: false,
    message: '',
    progress: 0,
    currentStep: 0,
    totalSteps: RECOVERY_STEPS.length
  }
}

function createRecoveryState(): RecoveryState {
  return {
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null,
    lastRecoveryAttempt: 0
  }
}

// Validation functions
const _validatePlaybackState = (
  state: SpotifyPlaybackState | null
): ValidationResult => {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  }

  if (!state) {
    result.isValid = false
    result.errors.push('No playback state available')
    return result
  }

  if (!state.device?.id) {
    result.isValid = false
    result.errors.push('No device ID in playback state')
  }

  if (!state.item?.uri) {
    result.isValid = false
    result.errors.push('No track URI in playback state')
  }

  if (typeof state.progress_ms !== 'number' || state.progress_ms < 0) {
    result.isValid = false
    result.errors.push('Invalid progress value')
  }

  return result
}

const validateDeviceStateDetails = (
  deviceId: string | null,
  state: SpotifyPlaybackState | null
): ValidationResult => {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  }

  if (!deviceId) {
    result.isValid = false
    result.errors.push('No device ID provided')
    return result
  }

  if (!state?.device?.id) {
    result.isValid = false
    result.errors.push('No device in playback state')
    return result
  }

  if (state.device.id !== deviceId) {
    result.isValid = false
    result.errors.push('Device ID mismatch')
  }

  if (!state.device.is_active) {
    result.warnings.push('Device is not active')
  }

  return result
}

// Unified recovery process
export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onDeviceStatusChange: (status: Pick<HealthStatus, 'device'>) => void
): RecoverySystemHook {
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(
    createRecoveryStatus()
  )
  const [recoveryState, setRecoveryState] = useState<RecoveryState>(
    createRecoveryState()
  )
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const isMounted = useRef(true)

  const attemptRecovery = useCallback(async () => {
    if (recoveryStatus.isRecovering) {
      console.log('[Recovery] Recovery already in progress, skipping')
      return
    }

    if (!deviceId) {
      console.error('Cannot start recovery: No device ID available')
      return
    }

    const now = Date.now()
    if (now - recoveryState.lastRecoveryAttempt < RECOVERY_COOLDOWN) {
      console.log('[Recovery] Recovery attempted recently, skipping')
      return
    }

    console.log('Starting recovery attempt', {
      deviceId,
      playlistId: fixedPlaylistId,
      timestamp: new Date().toISOString()
    })

    setRecoveryStatus({
      isRecovering: true,
      message: 'Starting recovery process...',
      progress: 0,
      currentStep: 0,
      totalSteps: RECOVERY_STEPS.length
    })

    setRecoveryAttempts((prev) => prev + 1)
    setRecoveryState((prev) => ({
      ...prev,
      lastRecoveryAttempt: now
    }))

    try {
      // Step 1: Get current playback state and verify device state
      console.log('Recovery Step 1: Getting playback state', {
        deviceId,
        timestamp: new Date().toISOString()
      })

      const currentState = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      // Validate playback state
      const playbackValidation = _validatePlaybackState(currentState)
      if (!playbackValidation.isValid) {
        console.error(
          'Playback state validation failed:',
          playbackValidation.errors
        )
        throw new Error('Playback state validation failed')
      }

      // Verify device state
      const deviceState = validateDeviceStateDetails(deviceId, currentState)
      if (!deviceState.isValid) {
        console.log('Device state validation failed', {
          errors: deviceState.errors,
          timestamp: new Date().toISOString()
        })
        throw new Error('Device state validation failed')
      }

      // Step 2: Handle specific error types
      const errorType = determineErrorType(recoveryState.lastErrorType)
      console.log('Recovery Step 2: Handling error type:', errorType)

      switch (errorType) {
        case ErrorType.AUTH:
          if (typeof window.refreshSpotifyPlayer === 'function') {
            await window.refreshSpotifyPlayer()
          }
          break

        case ErrorType.DEVICE:
          await transferPlaybackToDevice(deviceId)
          break

        case ErrorType.CONNECTION:
          if (typeof window.spotifyPlayerInstance?.connect === 'function') {
            await window.spotifyPlayerInstance.connect()
          }
          break

        case ErrorType.PLAYBACK:
          if (fixedPlaylistId) {
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: 0
              }
            })
          }
          break
      }

      // Step 3: Verify recovery
      console.log('Recovery Step 3: Verifying recovery', {
        deviceId,
        timestamp: new Date().toISOString()
      })

      const isActive = await verifyDeviceTransfer(deviceId)
      if (!isActive) {
        throw new Error(ERROR_MESSAGES.RECOVERY_VERIFICATION_FAILED)
      }

      // Update state on success
      setRecoveryState((prev) => ({
        ...prev,
        lastErrorType: null,
        consecutiveFailures: 0,
        lastSuccessfulPlayback: {
          trackUri: currentState?.item?.uri ?? null,
          position: currentState?.progress_ms ?? 0,
          timestamp: Date.now()
        }
      }))

      setRecoveryStatus({
        isRecovering: false,
        message: 'Recovery successful!',
        progress: 100,
        currentStep: RECOVERY_STEPS.length,
        totalSteps: RECOVERY_STEPS.length
      })

      onDeviceStatusChange({ device: 'healthy' })
    } catch (error) {
      console.error('Recovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        deviceId,
        timestamp: new Date().toISOString()
      })

      setRecoveryState((prev) => ({
        ...prev,
        lastErrorType: determineErrorType(error),
        consecutiveFailures: prev.consecutiveFailures + 1
      }))

      setRecoveryStatus({
        isRecovering: false,
        message: 'Recovery failed',
        progress: 0,
        currentStep: 0,
        totalSteps: RECOVERY_STEPS.length
      })

      throw error
    } finally {
      setRecoveryStatus(createRecoveryStatus())
    }
  }, [
    deviceId,
    fixedPlaylistId,
    onDeviceStatusChange,
    recoveryStatus.isRecovering,
    recoveryState.lastErrorType,
    recoveryState.lastRecoveryAttempt
  ])

  // Cleanup effect
  useEffect(() => {
    const timeoutRef = recoveryTimeout.current
    return () => {
      isMounted.current = false
      if (timeoutRef) {
        clearTimeout(timeoutRef)
      }
    }
  }, [])

  return {
    recoveryStatus,
    recoveryState,
    recoveryAttempts,
    attemptRecovery,
    setRecoveryState: (newState: RecoveryState): void => {
      if (isMounted.current) {
        setRecoveryState(newState)
      }
    }
  }
}
