import { useState, useCallback, useRef, useEffect } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, HealthStatus } from '@/shared/types'
import {
  RecoveryState,
  RecoveryStatus,
  PlaybackVerificationResult,
  ErrorRecoveryState,
  ValidationResult,
  RecoverySystemHook,
  ErrorType
} from '@/shared/types/recovery'
import {
  verifyDeviceTransfer,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_COOLDOWN,
  STATE_UPDATE_TIMEOUT,
  PLAYBACK_VERIFICATION_TIMEOUT,
  PLAYBACK_CHECK_INTERVAL,
  RECOVERY_STATUS_CLEAR_DELAY,
  STORED_STATE_MAX_AGE,
  RECOVERY_STEPS,
  ERROR_MESSAGES
} from '@/shared/constants/recovery'

// Add error recovery helper functions
const errorRecoveryState: ErrorRecoveryState = {
  lastError: null,
  errorCount: 0,
  lastRecoveryAttempt: 0,
  recoveryInProgress: false
}

// Add state validation helper functions
const validatePlaybackState = (
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

  // Validate device
  if (!state.device?.id) {
    result.isValid = false
    result.errors.push('No device ID in playback state')
  }

  // Validate track
  if (!state.item?.uri) {
    result.isValid = false
    result.errors.push('No track URI in playback state')
  } else if (!validateSpotifyUri(state.item.uri)) {
    result.isValid = false
    result.errors.push('Invalid track URI format')
  }

  // Validate progress
  if (typeof state.progress_ms !== 'number') {
    result.isValid = false
    result.errors.push('Invalid progress value')
  } else if (state.progress_ms < 0) {
    result.isValid = false
    result.errors.push('Negative progress value')
  } else if (
    state.item?.duration_ms &&
    state.progress_ms > state.item.duration_ms
  ) {
    result.isValid = false
    result.errors.push('Progress exceeds track duration')
  }

  // Validate context
  if (!state.context?.uri) {
    result.warnings.push('No context URI in playback state')
  } else if (!validateSpotifyUri(state.context.uri)) {
    result.warnings.push('Invalid context URI format')
  }

  // Validate timestamps
  if (state.timestamp && state.timestamp > Date.now()) {
    result.warnings.push('Future timestamp detected')
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

  if (state.device.volume_percent === undefined) {
    result.warnings.push('Device volume not set')
  }

  return result
}

const validatePlaybackRequest = (
  contextUri: string,
  positionMs: number,
  offsetUri?: string
): ValidationResult => {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  }

  if (!validateSpotifyUri(contextUri)) {
    result.isValid = false
    result.errors.push('Invalid context URI')
  }

  if (typeof positionMs !== 'number' || positionMs < 0) {
    result.isValid = false
    result.errors.push('Invalid position value')
  }

  if (offsetUri && !validateSpotifyUri(offsetUri)) {
    result.isValid = false
    result.errors.push('Invalid offset URI')
  }

  return result
}

// Add validation functions
function validateSpotifyUri(uri: string): boolean {
  if (!uri) return false
  const spotifyUriPattern =
    /^spotify:(track|playlist|album|artist):[a-zA-Z0-9]+$/
  return spotifyUriPattern.test(uri)
}

function validatePlaylistId(playlistId: string | null): boolean {
  if (!playlistId) return false
  const playlistIdPattern = /^[a-zA-Z0-9]{22}$/
  return playlistIdPattern.test(playlistId)
}

// Add state management helper functions
function createRecoveryState(): RecoveryState {
  return {
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null
  }
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

// Add state update helper
function updateRecoveryState(
  currentState: RecoveryState,
  updates: Partial<RecoveryState>
): RecoveryState {
  return {
    ...currentState,
    ...updates,
    lastSuccessfulPlayback: {
      ...currentState.lastSuccessfulPlayback,
      ...(updates.lastSuccessfulPlayback ?? {})
    }
  }
}

// Add cleanup helper functions
function cleanupRecoveryResources(): void {
  if (typeof window.spotifyPlayerInstance?.disconnect === 'function') {
    try {
      window.spotifyPlayerInstance.disconnect()
    } catch (error) {
      console.error('[Cleanup] Failed to disconnect player:', error)
    }
  }
}

async function cleanupPlaybackState(): Promise<void> {
  try {
    // Check if we're in initialization
    const isInitializing =
      document.body.getAttribute('data-spotify-sdk-ready') !== 'true'
    if (isInitializing) {
      console.log('[Cleanup] Skipping playback cleanup during initialization')
      return
    }

    await sendApiRequest({
      path: 'me/player/pause',
      method: 'PUT'
    })
  } catch (error) {
    console.error('[Cleanup] Failed to pause playback:', error)
  }
}

async function handleErrorRecovery(
  error: unknown,
  deviceId: string | null,
  fixedPlaylistId: string | null
): Promise<boolean> {
  if (errorRecoveryState.recoveryInProgress) {
    console.log('[Error Recovery] Recovery already in progress, skipping')
    return false
  }

  const now = Date.now()
  if (now - errorRecoveryState.lastRecoveryAttempt < RECOVERY_COOLDOWN) {
    // 5 seconds
    console.log('[Error Recovery] Recovery attempted recently, skipping')
    return false
  }

  errorRecoveryState.recoveryInProgress = true
  errorRecoveryState.lastError =
    error instanceof Error ? error : new Error(String(error))
  errorRecoveryState.errorCount++
  errorRecoveryState.lastRecoveryAttempt = now

  try {
    const errorType = determineErrorType(error)
    console.log('[Error Recovery] Starting recovery for error type:', errorType)

    switch (errorType) {
      case ErrorType.AUTH:
        // Handle auth errors
        if (typeof window.refreshSpotifyPlayer === 'function') {
          await window.refreshSpotifyPlayer()
        }
        break

      case ErrorType.DEVICE:
        // Handle device errors
        if (deviceId) {
          await transferPlaybackToDevice(deviceId)
        }
        break

      case ErrorType.CONNECTION:
        // Handle connection errors
        if (typeof window.spotifyPlayerInstance?.connect === 'function') {
          await window.spotifyPlayerInstance.connect()
        }
        break

      case ErrorType.PLAYBACK:
        // Handle playback errors
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

    // Verify recovery was successful
    if (deviceId) {
      const isActive = await verifyDeviceTransfer(deviceId)
      if (!isActive) {
        throw new Error(ERROR_MESSAGES.RECOVERY_VERIFICATION_FAILED)
      }
    }

    errorRecoveryState.errorCount = 0
    return true
  } catch (recoveryError) {
    console.error('[Error Recovery] Recovery failed:', recoveryError)
    return false
  } finally {
    errorRecoveryState.recoveryInProgress = false
  }
}

// Update verifyPlaybackResume to use validation
const verifyPlaybackResume = async (
  expectedContextUri: string,
  currentDeviceId: string | null,
  maxVerificationTime: number = PLAYBACK_VERIFICATION_TIMEOUT,
  checkInterval: number = PLAYBACK_CHECK_INTERVAL
): Promise<PlaybackVerificationResult> => {
  const startTime = Date.now()
  console.log('[Playback Verification] Starting verification process', {
    expectedContextUri,
    currentDeviceId,
    maxVerificationTime,
    checkInterval,
    timestamp: new Date().toISOString()
  })

  const initialState = await sendApiRequest<SpotifyPlaybackState>({
    path: 'me/player',
    method: 'GET'
  })

  // Validate initial state
  const stateValidation = validatePlaybackState(initialState)
  if (!stateValidation.isValid) {
    console.error(
      '[Playback Verification] Invalid initial state:',
      stateValidation.errors
    )
    throw new Error(
      `Invalid playback state: ${stateValidation.errors.join(', ')}`
    )
  }

  // Validate device state
  const deviceValidation = validateDeviceStateDetails(
    currentDeviceId,
    initialState
  )
  if (!deviceValidation.isValid) {
    console.error(
      '[Playback Verification] Invalid device state:',
      deviceValidation.errors
    )
    throw new Error(
      `Invalid device state: ${deviceValidation.errors.join(', ')}`
    )
  }

  console.log('[Playback Verification] Initial state:', {
    deviceId: initialState?.device?.id,
    isPlaying: initialState?.is_playing,
    progress: initialState?.progress_ms,
    context: initialState?.context?.uri,
    currentTrack: initialState?.item?.name,
    timestamp: new Date().toISOString()
  })

  const initialProgress = initialState?.progress_ms ?? 0
  let lastProgress = initialProgress
  let currentState: SpotifyPlaybackState | null = null
  let progressStalled = false

  while (Date.now() - startTime < maxVerificationTime) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval))

    currentState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    // Validate current state
    const currentStateValidation = validatePlaybackState(currentState)
    if (!currentStateValidation.isValid) {
      console.error(
        '[Playback Verification] Invalid current state:',
        currentStateValidation.errors
      )
      throw new Error(
        `Invalid playback state: ${currentStateValidation.errors.join(', ')}`
      )
    }

    const currentProgress = currentState.progress_ms ?? 0

    if (currentProgress > lastProgress) {
      lastProgress = currentProgress
      progressStalled = false
    } else {
      const isNearEnd =
        currentState.item?.duration_ms &&
        currentState.item.duration_ms - currentProgress < 5000

      if (!isNearEnd) {
        progressStalled = true
      }
    }

    console.log('[Playback Verification] Progress check:', {
      currentProgress,
      lastProgress,
      progressStalled,
      timestamp: new Date().toISOString()
    })

    if (!progressStalled && currentState.device?.id === currentDeviceId) {
      break
    }
  }

  if (!currentState) {
    throw new Error('Failed to get playback state')
  }

  const verificationResult: PlaybackVerificationResult = {
    isSuccessful:
      !progressStalled && currentState.device?.id === currentDeviceId,
    reason: progressStalled
      ? 'Playback progress stalled'
      : currentState.device?.id !== currentDeviceId
        ? 'Device mismatch'
        : 'Playback resumed successfully',
    details: {
      deviceMatch: currentState.device?.id === currentDeviceId,
      isPlaying: currentState.is_playing,
      progressAdvancing: !progressStalled,
      contextMatch: currentState.context?.uri === expectedContextUri,
      currentTrack: currentState.item?.name,
      timestamp: Date.now(),
      verificationDuration: Date.now() - startTime
    }
  }

  return verificationResult
}

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
  const lastStateUpdate = useRef<number>(Date.now())

  // Add state update effect
  useEffect(() => {
    const now = Date.now()
    if (now - lastStateUpdate.current > STATE_UPDATE_TIMEOUT) {
      // 5 seconds
      console.log('[Recovery] State update timeout, resetting state')
      setRecoveryStatus(createRecoveryStatus())
      setRecoveryState(createRecoveryState())
      setRecoveryAttempts(0)
    }
    lastStateUpdate.current = now
  }, [recoveryStatus, recoveryState])

  // Add cleanup effect
  useEffect(() => {
    const cleanup = async (): Promise<void> => {
      isMounted.current = false

      // Clear all timeouts
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
        recoveryTimeout.current = null
      }

      // Cleanup player resources
      cleanupRecoveryResources()

      // Reset state
      setRecoveryStatus(createRecoveryStatus())
      setRecoveryState(createRecoveryState())
      setRecoveryAttempts(0)

      // Pause playback
      await cleanupPlaybackState()
    }

    return (): void => {
      void cleanup()
    }
  }, [])

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (!isMounted.current) return

    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error(
        '[Recovery] Max attempts reached, attempting final recovery...',
        {
          attempts: recoveryAttempts,
          maxAttempts: MAX_RECOVERY_ATTEMPTS,
          timestamp: new Date().toISOString()
        }
      )
      setRecoveryStatus({
        isRecovering: true,
        message: 'Attempting final recovery with stored state...',
        progress: 90,
        currentStep: 0,
        totalSteps: RECOVERY_STEPS.length
      })

      // Try one last recovery with stored state
      const lastState = recoveryState.lastSuccessfulPlayback
      if (
        lastState &&
        Date.now() - lastState.timestamp < STORED_STATE_MAX_AGE
      ) {
        try {
          console.log('[Recovery] Attempting recovery with stored state:', {
            trackUri: lastState.trackUri,
            position: lastState.position,
            age: Date.now() - lastState.timestamp,
            maxAge: STORED_STATE_MAX_AGE,
            timestamp: new Date().toISOString()
          })
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: lastState.position,
              offset: { uri: lastState.trackUri }
            }
          })

          // Update state atomically
          setRecoveryState((prev) =>
            updateRecoveryState(prev, {
              consecutiveFailures: 0,
              lastErrorType: null
            })
          )
          setRecoveryAttempts(0)
          setRecoveryStatus({
            isRecovering: false,
            message: 'Recovery successful!',
            progress: 100,
            currentStep: RECOVERY_STEPS.length,
            totalSteps: RECOVERY_STEPS.length
          })

          // Update device status
          onDeviceStatusChange({ device: 'healthy' })
          console.log('[Recovery] Final recovery attempt successful', {
            timestamp: new Date().toISOString()
          })
          return
        } catch (error) {
          console.error('[Recovery] Final recovery attempt failed:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            errorType: error instanceof Error ? error.name : 'Unknown',
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
          })
        }
      }
    }

    console.log('[Recovery] Starting recovery attempt', {
      attempt: recoveryAttempts + 1,
      maxAttempts: MAX_RECOVERY_ATTEMPTS,
      deviceId,
      fixedPlaylistId,
      timestamp: new Date().toISOString()
    })

    // Reset state at start of recovery
    setRecoveryStatus({
      isRecovering: true,
      message: 'Starting recovery process...',
      progress: 0,
      currentStep: 0,
      totalSteps: RECOVERY_STEPS.length
    })

    let currentProgress = 0
    const updateProgress = (
      step: number,
      success: boolean,
      error?: unknown
    ): void => {
      if (!isMounted.current) return

      currentProgress += RECOVERY_STEPS[step].weight * 100
      setRecoveryStatus((prev) => ({
        ...prev,
        message: `${RECOVERY_STEPS[step].message} ${success ? '✓' : '✗'}`,
        progress: Math.min(currentProgress, 100),
        currentStep: step + 1
      }))

      if (!success && error) {
        const errorType = determineErrorType(error)
        setRecoveryState((prev) =>
          updateRecoveryState(prev, {
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: errorType
          })
        )
      }
    }

    // Step 1: Refresh player state
    if (typeof window.refreshSpotifyPlayer === 'function') {
      try {
        console.log('[Recovery] Step 1: Refreshing player state')
        cleanupRecoveryResources()
        await window.refreshSpotifyPlayer()

        // Validate state after refresh
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })
        const stateValidation = validatePlaybackState(state)
        if (!stateValidation.isValid) {
          throw new Error(
            `Invalid state after refresh: ${stateValidation.errors.join(', ')}`
          )
        }

        console.log('[Recovery] Player state refresh successful', {
          isPlaying: state.is_playing,
          deviceId: state.device?.id,
          trackName: state.item?.name,
          timestamp: new Date().toISOString()
        })
        updateProgress(0, true)
      } catch (error) {
        console.error('[Recovery] Failed to refresh player state:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: error instanceof Error ? error.name : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString()
        })
        updateProgress(0, false, error)
        await handleErrorRecovery(error, deviceId, fixedPlaylistId)
      }
    }

    // Step 2: Reconnect player
    if (typeof window.spotifyPlayerInstance?.connect === 'function') {
      try {
        console.log('[Recovery] Step 2: Reconnecting player')
        // Cleanup before reconnect
        cleanupRecoveryResources()
        await window.spotifyPlayerInstance.connect()
        console.log('[Recovery] Player reconnection successful', {
          timestamp: new Date().toISOString()
        })
        updateProgress(2, true)
      } catch (error) {
        console.error('[Recovery] Failed to reconnect player:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: error instanceof Error ? error.name : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString()
        })
        updateProgress(2, false, error)
      }
    }

    // Step 3: Reinitialize player and resume playback
    if (typeof window.initializeSpotifyPlayer === 'function') {
      try {
        console.log('[Recovery] Step 3: Reinitializing player')
        // Get current playback state before reinitializing
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // Validate current state
        if (!validatePlaybackState(currentState)) {
          throw new Error(ERROR_MESSAGES.INVALID_PLAYBACK_STATE)
        }

        // Validate playlist ID
        if (!validatePlaylistId(fixedPlaylistId)) {
          throw new Error(ERROR_MESSAGES.INVALID_PLAYLIST_ID)
        }

        // Cleanup before initialization
        cleanupRecoveryResources()
        await window.initializeSpotifyPlayer()
        console.log('[Recovery] Player reinitialization successful', {
          timestamp: new Date().toISOString()
        })
        updateProgress(3, true)

        // Resume playback from last position with validation
        if (currentState.item?.uri) {
          console.log('[Recovery] Attempting to resume playback', {
            trackUri: currentState.item.uri,
            position: currentState.progress_ms,
            timestamp: new Date().toISOString()
          })

          const playbackRequest = {
            context_uri: `spotify:playlist:${fixedPlaylistId}`,
            position_ms: Math.max(0, currentState.progress_ms ?? 0),
            offset: currentState?.item?.uri
              ? { uri: currentState.item.uri }
              : undefined
          }

          // Validate the request before sending
          const requestValidation = validatePlaybackRequest(
            playbackRequest.context_uri,
            playbackRequest.position_ms,
            playbackRequest.offset?.uri
          )

          if (!requestValidation.isValid) {
            throw new Error(
              `Invalid playback request: ${requestValidation.errors.join(', ')}`
            )
          }

          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: playbackRequest,
            debounceTime: 60000 // 1 minute debounce
          })

          // Verify playback resumed correctly with additional validation
          console.log('[Recovery] Starting playback verification')
          const verificationResult = await verifyPlaybackResume(
            `spotify:playlist:${fixedPlaylistId}`,
            deviceId
          )

          if (!verificationResult.isSuccessful) {
            console.error('[Recovery] Playback verification failed:', {
              reason: verificationResult.reason,
              details: verificationResult.details,
              timestamp: new Date().toISOString()
            })

            // Attempt retry with different strategy based on failure reason
            if (verificationResult.details?.deviceMatch === false) {
              console.log('[Recovery] Retrying device transfer')
              await sendApiRequest({
                path: 'me/player',
                method: 'PUT',
                body: {
                  device_ids: [deviceId],
                  play: false
                }
              })
            } else if (verificationResult.details?.isPlaying === false) {
              console.log('[Recovery] Retrying playback start')
              // Validate before retrying
              if (validatePlaylistId(fixedPlaylistId)) {
                await sendApiRequest({
                  path: 'me/player/play',
                  method: 'PUT',
                  body: {
                    context_uri: `spotify:playlist:${fixedPlaylistId}`,
                    position_ms: Math.max(0, currentState?.progress_ms ?? 0)
                  }
                })
              } else {
                throw new Error('Invalid playlist ID during retry')
              }
            } else if (
              verificationResult.details?.progressAdvancing === false
            ) {
              console.log('[Recovery] Retrying with next track')
              await sendApiRequest({
                path: 'me/player/next',
                method: 'POST'
              })
            }

            // Verify again after retry with validation
            console.log('[Recovery] Starting retry verification')
            const retryVerification = await verifyPlaybackResume(
              `spotify:playlist:${fixedPlaylistId}`,
              deviceId
            )

            if (!retryVerification.isSuccessful) {
              console.error('[Recovery] Retry verification failed:', {
                reason: retryVerification.reason,
                details: retryVerification.details,
                timestamp: new Date().toISOString()
              })
              throw new Error(
                `Playback verification failed after retry: ${retryVerification.reason}`
              )
            }
          }

          console.log('[Recovery] Playback verification successful', {
            timestamp: new Date().toISOString()
          })
        }
      } catch (error) {
        console.error('[Recovery] Failed to reinitialize player:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: error instanceof Error ? error.name : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString()
        })
        updateProgress(3, false, error)
      }
    }

    // Update state atomically on success
    setRecoveryState((prev) =>
      updateRecoveryState(prev, {
        consecutiveFailures: 0,
        lastErrorType: null
      })
    )
    setRecoveryAttempts(0)
    setRecoveryStatus({
      isRecovering: false,
      message: 'Recovery successful!',
      progress: 100,
      currentStep: RECOVERY_STEPS.length,
      totalSteps: RECOVERY_STEPS.length
    })

    console.log('[Recovery] Recovery process completed successfully', {
      timestamp: new Date().toISOString()
    })

    // Clear recovery status after 3 seconds
    setTimeout(() => {
      if (isMounted.current) {
        setRecoveryStatus(createRecoveryStatus())
      }
    }, RECOVERY_STATUS_CLEAR_DELAY)
  }, [
    recoveryAttempts,
    fixedPlaylistId,
    deviceId,
    recoveryState,
    onDeviceStatusChange
  ])

  return {
    recoveryStatus,
    recoveryState,
    recoveryAttempts,
    attemptRecovery,
    setRecoveryState: (newState: RecoveryState): void => {
      if (isMounted.current) {
        setRecoveryState((prev) => updateRecoveryState(prev, newState))
      }
    }
  }
}
