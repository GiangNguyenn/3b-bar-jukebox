import { useState, useCallback, useRef, useEffect } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, HealthStatus } from '@/shared/types'
import { executeWithErrorBoundary } from '@/shared/utils/errorBoundary'
import { SpotifyApiService } from '@/services/spotifyApi'
import {
  RecoveryState,
  PlaybackVerificationResult,
  ErrorRecoveryState,
  ValidationResult,
  ErrorType,
  DeviceVerificationState
} from '@/shared/types/recovery'
import {
  verifyDeviceTransfer,
  transferPlaybackToDevice,
  validateDeviceState,
  checkDeviceExists
} from '@/services/deviceManagement'
import { BASE_DELAY, RECOVERY_STEPS } from '@/shared/constants/recovery'
import { verifyDevicePlaybackState } from '@/app/admin/components/recovery/utils/playback-verification'

// Recovery system constants
const MAX_VERIFICATION_RETRIES = 3
const MAX_RECOVERY_RETRIES = 5
const RECOVERY_TIMEOUT = 30000 // 30 seconds
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_TIMEOUT = 30000 // 30 seconds
const VERIFICATION_LOCK_TIMEOUT = 5000 // 5 seconds

// Circuit breaker state
let consecutiveFailures = 0
let lastFailureTime = 0

// Helper function to check if circuit breaker is active
function isCircuitBreakerActive(): boolean {
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    const timeSinceLastFailure = Date.now() - lastFailureTime
    if (timeSinceLastFailure < CIRCUIT_BREAKER_TIMEOUT) {
      return true
    }
    consecutiveFailures = 0
  }
  return false
}

// Helper function to update circuit breaker state
function updateCircuitBreakerState(success: boolean): void {
  if (success) {
    consecutiveFailures = 0
  } else {
    consecutiveFailures++
    lastFailureTime = Date.now()
  }
}

type RecoveryPhase =
  | 'idle'
  | 'initializing'
  | 'refreshing_player'
  | 'ensuring_device'
  | 'reconnecting'
  | 'reinitializing'
  | 'verifying'
  | 'success'
  | 'error'

interface ExtendedRecoveryState extends RecoveryState {
  phase: RecoveryPhase
  attempts: number
  status: {
    message: string
    progress: number
    error: string | null
  }
  verification: DeviceVerificationState
}

interface DeviceTransferResult {
  success: boolean
  deviceId: string | null
  error?: string
}

interface PlaybackState {
  isPlaying: boolean
  deviceId: string | null
  trackUri: string | null
  position: number
  volume: number
  playlistId: string | null
}

interface PlaylistResponse {
  name: string
  tracks: {
    items: Array<{
      track: {
        uri: string
        name: string
      }
    }>
  }
}

interface TrackResponse {
  name: string
}

async function verifyPlaybackResume(
  expectedContextUri: string,
  currentDeviceId: string | null,
  maxVerificationTime: number = 10000, // 10 seconds
  checkInterval: number = 1000 // 1 second
): Promise<PlaybackVerificationResult> {
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

  console.log('[Playback Verification] Initial state:', {
    deviceId: initialState?.device?.id,
    isPlaying: initialState?.is_playing,
    progress: initialState?.progress_ms,
    context: initialState?.context?.uri,
    currentTrack: initialState?.item?.name,
    timestamp: new Date().toISOString()
  })

  const initialProgress = initialState?.progress_ms ?? 0
  const lastProgress = initialProgress
  const _progressStalled = false
  let currentState: SpotifyPlaybackState | null = null

  while (Date.now() - startTime < maxVerificationTime) {
    currentState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
  }

  if (!currentState) {
    throw new Error('Failed to get playback state')
  }

  const verificationResult: PlaybackVerificationResult = {
    isSuccessful: true,
    reason: 'Playback resumed successfully',
    details: {
      deviceMatch: currentState.device?.id === currentDeviceId,
      isPlaying: currentState.is_playing,
      progressAdvancing: currentState.progress_ms > lastProgress,
      contextMatch: currentState.context?.uri === expectedContextUri,
      currentTrack: currentState.item?.name,
      timestamp: Date.now(),
      verificationDuration: Date.now() - startTime
    }
  }

  return verificationResult
}

async function validatePlaylist(playlistId: string): Promise<boolean> {
  try {
    const response = await sendApiRequest({
      path: `playlists/${playlistId}`,
      method: 'GET'
    })
    return !!response
  } catch {
    return false
  }
}

async function validateTrack(trackUri: string): Promise<boolean> {
  try {
    const response = await sendApiRequest({
      path: `tracks/${trackUri.split(':').pop()}`,
      method: 'GET'
    })
    return !!response
  } catch {
    return false
  }
}

async function ensurePlaybackState(
  deviceId: string | null,
  fixedPlaylistId: string | null
): Promise<void> {
  if (!deviceId || !fixedPlaylistId) {
    throw new Error('Missing device ID or playlist ID')
  }

  try {
    // First verify device is active
    const isActive = await verifyDeviceTransfer(deviceId)
    if (!isActive) {
      // Try to transfer playback
      const transferSuccessful = await transferPlaybackToDevice(deviceId)
      if (!transferSuccessful) {
        throw new Error('Failed to transfer playback to device')
      }
    }

    // Validate playlist and track
    const isPlaylistValid = await validatePlaylist(fixedPlaylistId)
    if (!isPlaylistValid) {
      console.error('[Playback] Playlist is no longer available')
      throw new Error('Playlist not found')
    }

    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
    const trackUri = state?.item?.uri

    if (trackUri) {
      const isTrackValid = await validateTrack(trackUri)
      if (!isTrackValid) {
        console.error('[Playback] Track is no longer available')
        throw new Error('Track not found')
      }
    }
  } catch (error) {
    console.error('[Recovery] Failed to ensure playback state:', error)
    throw error
  }
}

async function validatePlaybackStateWithDetails(
  playlistId: string,
  trackUri: string | null,
  position: number
): Promise<{
  isValid: boolean
  error?: string
  details?: {
    playlistValid: boolean
    trackValid: boolean
    positionValid: boolean
    playlistName?: string
    trackName?: string
  }
}> {
  console.log('[Playback Validation] Starting validation:', {
    playlistId,
    trackUri,
    position,
    timestamp: new Date().toISOString()
  })

  try {
    // Validate playlist exists and is accessible
    const playlistResponse = await sendApiRequest<PlaylistResponse>({
      path: `playlists/${playlistId}`,
      method: 'GET'
    })

    if (!playlistResponse) {
      console.error('[Playback Validation] Playlist not found:', {
        playlistId,
        timestamp: new Date().toISOString()
      })
      return {
        isValid: false,
        error: 'Playlist not found',
        details: {
          playlistValid: false,
          trackValid: false,
          positionValid: false
        }
      }
    }

    // If we have a track URI, validate the track
    let trackValid = true
    let trackName: string | undefined
    if (trackUri) {
      try {
        const trackId = trackUri.split(':').pop()
        const trackResponse = await sendApiRequest<TrackResponse>({
          path: `tracks/${trackId}`,
          method: 'GET'
        })

        if (!trackResponse) {
          console.error('[Playback Validation] Track not found:', {
            trackUri,
            timestamp: new Date().toISOString()
          })
          trackValid = false
        } else {
          trackName = trackResponse.name
        }
      } catch (error) {
        console.error('[Playback Validation] Track validation failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          trackUri,
          timestamp: new Date().toISOString()
        })
        trackValid = false
      }
    }

    // Validate position is reasonable
    const positionValid = position >= 0 && position < 3600000 // Max 1 hour

    const isValid = trackValid && positionValid

    console.log('[Playback Validation] Validation complete:', {
      isValid,
      playlistValid: true,
      trackValid,
      positionValid,
      playlistName: playlistResponse.name,
      trackName,
      timestamp: new Date().toISOString()
    })

    return {
      isValid,
      error: !isValid ? 'Invalid playback state' : undefined,
      details: {
        playlistValid: true,
        trackValid,
        positionValid,
        playlistName: playlistResponse.name,
        trackName
      }
    }
  } catch (error) {
    console.error('[Playback Validation] Validation failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      playlistId,
      trackUri,
      timestamp: new Date().toISOString()
    })
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: {
        playlistValid: false,
        trackValid: false,
        positionValid: false
      }
    }
  }
}

// Add error recovery helper functions
const errorRecoveryState: ErrorRecoveryState = {
  lastError: null,
  errorCount: 0,
  lastRecoveryAttempt: 0,
  recoveryInProgress: false
}

// Add state validation helper functions
const validatePlaybackStateWithDevice = (
  state: SpotifyPlaybackState | null,
  deviceId: string | null
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

  // Use our new device management service for device validation
  const deviceValidation = validateDeviceState(deviceId, state)
  if (!deviceValidation.isValid) {
    result.isValid = false
    result.errors.push(...deviceValidation.errors)
  }

  if (!state.device) {
    result.isValid = false
    result.errors.push('No device information available')
  }

  if (!state.is_playing) {
    result.isValid = false
    result.errors.push('Playback is not active')
  }

  if (!state.context) {
    result.isValid = false
    result.errors.push('No playback context available')
  }

  return result
}

// Reset circuit breaker state
function resetCircuitBreaker(): void {
  consecutiveFailures = 0
  lastFailureTime = 0
}

export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onHealthStatusUpdate: (status: { device: string }) => void
) {
  const [state, setState] = useState<ExtendedRecoveryState>({
    phase: 'idle',
    attempts: 0,
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null,
    status: {
      message: '',
      progress: 0,
      error: null
    },
    verification: {
      isVerifying: false,
      lastVerification: 0,
      verificationLock: false
    }
  })

  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const isRecoveryInProgress = useRef(false)
  const cleanupTimeout = useRef<NodeJS.Timeout | null>(null)

  const updateState = useCallback(
    (
      updates:
        | Partial<ExtendedRecoveryState>
        | ((prev: ExtendedRecoveryState) => Partial<ExtendedRecoveryState>)
    ) => {
      setState((prev) => ({
        ...prev,
        ...(typeof updates === 'function' ? updates(prev) : updates)
      }))
    },
    []
  )

  const cleanupRecoveryState = useCallback(() => {
    console.log('[Recovery] Cleaning up recovery state:', {
      timestamp: new Date().toISOString()
    })

    // Clear any pending timeouts
    if (recoveryTimeout.current) {
      clearTimeout(recoveryTimeout.current)
      recoveryTimeout.current = null
    }

    if (cleanupTimeout.current) {
      clearTimeout(cleanupTimeout.current)
      cleanupTimeout.current = null
    }

    // Reset recovery flags
    isRecoveryInProgress.current = false

    // Reset verification lock
    updateState({
      verification: {
        isVerifying: false,
        lastVerification: 0,
        verificationLock: false
      }
    })

    // Clear status after a delay
    cleanupTimeout.current = setTimeout(() => {
      updateState({
        status: {
          message: '',
          progress: 0,
          error: null
        }
      })
    }, 3000)
  }, [updateState])

  const resetRecoveryState = useCallback(() => {
    console.log('[Recovery] Resetting recovery state:', {
      timestamp: new Date().toISOString()
    })

    isRecoveryInProgress.current = false
    if (recoveryTimeout.current) {
      clearTimeout(recoveryTimeout.current)
      recoveryTimeout.current = null
    }
    if (cleanupTimeout.current) {
      clearTimeout(cleanupTimeout.current)
      cleanupTimeout.current = null
    }

    updateState({
      phase: 'idle',
      attempts: 0,
      status: {
        message: '',
        progress: 0,
        error: null
      },
      verification: {
        isVerifying: false,
        lastVerification: 0,
        verificationLock: false
      }
    })

    // Reset circuit breaker state
    consecutiveFailures = 0
    lastFailureTime = 0
  }, [updateState])

  // Add cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecoveryState()
    }
  }, [cleanupRecoveryState])

  const transitionTo = useCallback(
    (
      phase: RecoveryPhase,
      message: string,
      progress: number,
      error: string | null = null
    ) => {
      updateState({
        phase,
        status: {
          message,
          progress,
          error
        }
      })
    },
    [updateState]
  )

  const acquireVerificationLock = useCallback(() => {
    if (state.verification.verificationLock) {
      const lockAge = Date.now() - state.verification.lastVerification
      if (lockAge < VERIFICATION_LOCK_TIMEOUT) {
        return false
      }
      // Force release stale lock
      releaseVerificationLock()
    }

    updateState({
      verification: {
        isVerifying: true,
        lastVerification: Date.now(),
        verificationLock: true
      }
    })
    return true
  }, [state.verification, updateState])

  const releaseVerificationLock = useCallback(() => {
    updateState({
      verification: {
        isVerifying: false,
        lastVerification: Date.now(),
        verificationLock: false
      }
    })
  }, [updateState])

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (isRecoveryInProgress.current) {
      console.log('[Recovery] Recovery already in progress, skipping...')
      return
    }

    if (isCircuitBreakerActive()) {
      console.log('[Recovery] Circuit breaker active, skipping recovery', {
        consecutiveFailures,
        lastFailureTime,
        timeSinceLastFailure: Date.now() - lastFailureTime
      })
      return
    }

    console.log('[Recovery] Starting recovery attempt', {
      deviceId,
      fixedPlaylistId,
      attempts: state.attempts,
      phase: state.phase,
      timestamp: new Date().toISOString()
    })

    isRecoveryInProgress.current = true

    try {
      // Step 1: Check if device exists
      if (deviceId) {
        const deviceExists = await checkDeviceExists(deviceId)
        if (!deviceExists) {
          console.error('[Recovery] Device not found:', deviceId)
          // Try to refresh the player to get updated device list
          if (typeof window.refreshSpotifyPlayer === 'function') {
            await window.refreshSpotifyPlayer()
          }
          // Wait a moment for the refresh to take effect
          await new Promise((resolve) => setTimeout(resolve, 2000))
          // Check again
          const deviceStillExists = await checkDeviceExists(deviceId)
          if (!deviceStillExists) {
            throw new Error('Device not found after refresh')
          }
        }
      }

      // Step 2: Ensure active device
      if (deviceId) {
        await ensurePlaybackState(deviceId, fixedPlaylistId)
      }

      transitionTo('initializing', 'Starting recovery process...', 0)

      // Create a promise that will timeout after RECOVERY_TIMEOUT
      const recoveryPromise = new Promise<void>(async (resolve, reject) => {
        try {
          let currentProgress = 0
          const updateProgress = (step: number, success: boolean): void => {
            currentProgress += RECOVERY_STEPS[step].weight * 100
            updateState({
              status: {
                message: `${RECOVERY_STEPS[step].message} ${success ? '✓' : '✗'}`,
                progress: Math.min(currentProgress, 100),
                error: null
              }
            })
          }

          // Step 3: Reconnect player
          if (typeof window.spotifyPlayerInstance?.connect === 'function') {
            try {
              await window.spotifyPlayerInstance.connect()
              updateProgress(2, true)
            } catch (error) {
              console.error('[Recovery] Failed to reconnect player:', error)
              updateProgress(2, false)
              updateState((prev) => ({
                consecutiveFailures: prev.consecutiveFailures + 1,
                lastErrorType: ErrorType.CONNECTION
              }))
              throw error
            }
          }

          // Step 4: Reinitialize player and resume playback
          if (typeof window.initializeSpotifyPlayer === 'function') {
            try {
              // Get current playback state before reinitializing
              const currentState = await sendApiRequest<SpotifyPlaybackState>({
                path: 'me/player',
                method: 'GET'
              })

              await window.initializeSpotifyPlayer()
              updateProgress(3, true)

              // Resume playback from last position
              if (currentState?.item?.uri && deviceId) {
                console.log(
                  '[Recovery] Validating playback state before resumption:',
                  {
                    trackUri: currentState.item.uri,
                    position: currentState.progress_ms,
                    timestamp: new Date().toISOString()
                  }
                )

                const validationResult = await validatePlaybackStateWithDetails(
                  fixedPlaylistId!,
                  currentState.item.uri,
                  currentState.progress_ms ?? 0
                )

                if (!validationResult.isValid) {
                  console.error('[Recovery] Playback validation failed:', {
                    error: validationResult.error,
                    details: validationResult.details,
                    timestamp: new Date().toISOString()
                  })

                  // If track is invalid, try to get the first track from the playlist
                  if (!validationResult.details?.trackValid) {
                    console.log(
                      '[Recovery] Attempting to get first track from playlist'
                    )
                    try {
                      const playlist = await sendApiRequest<PlaylistResponse>({
                        path: `playlists/${fixedPlaylistId}`,
                        method: 'GET'
                      })

                      if (playlist?.tracks?.items?.[0]?.track?.uri) {
                        console.log(
                          '[Recovery] Found first track, attempting playback'
                        )
                        const spotifyApi = SpotifyApiService.getInstance()
                        await spotifyApi.resumePlaybackAtPosition({
                          deviceId,
                          contextUri: `spotify:playlist:${fixedPlaylistId}`,
                          trackUri: playlist.tracks.items[0].track.uri,
                          position: 0
                        })
                      } else {
                        throw new Error('No tracks found in playlist')
                      }
                    } catch (error) {
                      console.error(
                        '[Recovery] Failed to get first track:',
                        error
                      )
                      throw new Error(
                        'Failed to resume playback: no valid tracks available'
                      )
                    }
                  } else {
                    throw new Error(
                      `Failed to resume playback: ${validationResult.error}`
                    )
                  }
                } else {
                  console.log(
                    '[Recovery] Playback state validated, resuming playback'
                  )
                  const spotifyApi = SpotifyApiService.getInstance()
                  await spotifyApi.resumePlaybackAtPosition({
                    deviceId,
                    contextUri: `spotify:playlist:${fixedPlaylistId}`,
                    trackUri: currentState.item.uri,
                    position: currentState.progress_ms ?? 0
                  })
                }
              }

              // Verify playback resumed correctly
              console.log('[Recovery] Starting playback verification')
              let verificationRetries = 0
              let verificationResult: PlaybackVerificationResult | null = null

              while (verificationRetries < MAX_VERIFICATION_RETRIES) {
                verificationResult = await verifyPlaybackResume(
                  `spotify:playlist:${fixedPlaylistId}`,
                  deviceId
                )

                if (verificationResult.isSuccessful) {
                  break
                }

                console.error('[Recovery] Playback verification failed:', {
                  reason: verificationResult.reason,
                  details: verificationResult.details,
                  attempt: verificationRetries + 1,
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
                  await sendApiRequest({
                    path: 'me/player/play',
                    method: 'PUT',
                    body: {
                      context_uri: `spotify:playlist:${fixedPlaylistId}`,
                      position_ms: currentState?.progress_ms ?? 0
                    }
                  })
                } else if (
                  verificationResult.details?.progressAdvancing === false
                ) {
                  console.log('[Recovery] Retrying with next track')
                  await sendApiRequest({
                    path: 'me/player/next',
                    method: 'POST'
                  })
                }

                verificationRetries++
                if (verificationRetries < MAX_VERIFICATION_RETRIES) {
                  await new Promise((resolve) =>
                    setTimeout(
                      resolve,
                      BASE_DELAY * Math.pow(2, verificationRetries)
                    )
                  )
                }
              }

              if (!verificationResult?.isSuccessful) {
                throw new Error(
                  `Playback verification failed after ${MAX_VERIFICATION_RETRIES} attempts`
                )
              }
            } catch (error) {
              console.error('[Recovery] Failed to reinitialize player:', error)
              updateProgress(3, false)
              updateState((prev) => ({
                consecutiveFailures: prev.consecutiveFailures + 1,
                lastErrorType: ErrorType.PLAYBACK
              }))
              throw error
            }
          }

          // If we get here, recovery was successful
          onHealthStatusUpdate({ device: 'healthy' })
          updateState({
            attempts: 0,
            phase: 'success',
            consecutiveFailures: 0,
            lastErrorType: null,
            status: {
              message: 'Recovery successful!',
              progress: 100,
              error: null
            }
          })
          updateCircuitBreakerState(true)
          cleanupRecoveryState()
          resolve()
        } catch (error) {
          reject(error)
        }
      })

      // Create a timeout promise
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Recovery timeout'))
        }, RECOVERY_TIMEOUT)
      })

      // Race the recovery against the timeout
      await Promise.race([recoveryPromise, timeoutPromise])
    } catch (error) {
      console.error('[Recovery] Failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        deviceId,
        fixedPlaylistId,
        attempts: state.attempts,
        phase: state.phase,
        timestamp: new Date().toISOString()
      })

      // Handle device not found error specifically
      if (
        error instanceof Error &&
        error.message.includes('Device not found')
      ) {
        // Try to refresh the player
        if (typeof window.refreshSpotifyPlayer === 'function') {
          try {
            await window.refreshSpotifyPlayer()
            // Wait for refresh to take effect
            await new Promise((resolve) => setTimeout(resolve, 2000))
            // Try recovery again
            isRecoveryInProgress.current = false
            await attemptRecovery()
            return
          } catch (refreshError) {
            console.error('[Recovery] Failed to refresh player:', refreshError)
          }
        }
      }

      const errorType = error instanceof Error ? error.message : 'Unknown error'

      // Update error type handling to use ErrorType enum
      let recoveryErrorType: ErrorType = ErrorType.PLAYBACK
      if (errorType.includes('auth') || errorType.includes('token')) {
        recoveryErrorType = ErrorType.AUTH
      } else if (
        errorType.includes('device') ||
        errorType.includes('transfer')
      ) {
        recoveryErrorType = ErrorType.DEVICE
      } else if (
        errorType.includes('network') ||
        errorType.includes('connection')
      ) {
        recoveryErrorType = ErrorType.CONNECTION
      }

      updateState({
        attempts: state.attempts + 1,
        phase: 'error',
        consecutiveFailures: state.consecutiveFailures + 1,
        lastErrorType: recoveryErrorType,
        status: {
          message: 'An error occurred. Please try again later.',
          progress: 100,
          error: errorType
        }
      })

      updateCircuitBreakerState(false)

      // If we've reached max attempts, clean up and reload
      if (state.attempts >= MAX_RECOVERY_RETRIES) {
        console.error(
          '[Recovery] Max attempts reached, cleaning up and reloading'
        )
        cleanupRecoveryState()
        setTimeout(() => {
          window.location.reload()
        }, 2000)
        return
      }

      // Calculate delay with exponential backoff
      const delay = BASE_DELAY * Math.pow(2, state.attempts)
      recoveryTimeout.current = setTimeout(() => {
        void attemptRecovery()
      }, delay)
    } finally {
      isRecoveryInProgress.current = false
    }
  }, [
    state,
    fixedPlaylistId,
    deviceId,
    onHealthStatusUpdate,
    updateState,
    transitionTo,
    cleanupRecoveryState
  ])

  return {
    state,
    attemptRecovery,
    updateState,
    resetCircuitBreaker
  }
}
