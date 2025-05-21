import { useState, useCallback, useRef, useEffect } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
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
import { verifyPlaybackResume } from '@/shared/utils/recovery/playback-verification'
import { validatePlaybackStateWithDetails } from '@/shared/utils/recovery/validation'
import { handleErrorRecovery } from '@/shared/utils/recovery/error-handling'
import { cleanupRecoveryResources, cleanupPlaybackState } from '@/shared/utils/recovery/state-management'

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
  currentDeviceId: string | null
  fixedPlaylistId: string | null
  isRecovering: boolean
  currentStep: number
  totalSteps: number
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

type DeviceHealthStatus = 'healthy' | 'unresponsive' | 'disconnected' | 'unknown'

export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onHealthStatusUpdate: (status: { device: DeviceHealthStatus }) => void
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
    lastRecoveryAttempt: 0,
    status: {
      message: '',
      progress: 0,
      error: null
    },
    verification: {
      isVerifying: false,
      lastVerification: 0,
      verificationLock: false
    },
    currentDeviceId: deviceId,
    fixedPlaylistId,
    isRecovering: false,
    currentStep: 0,
    totalSteps: Object.keys(RECOVERY_STEPS).length
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

    // Reset verification lock and set isRecovering to false
    updateState({
      isRecovering: false,
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
      isRecovering: false,
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
      const stepIndex = RECOVERY_STEPS.findIndex(
        (step) => step.message === message
      )
      updateState({
        phase,
        status: {
          message,
          progress,
          error
        },
        isRecovering: phase !== 'idle' && phase !== 'success' && phase !== 'error',
        currentStep: stepIndex >= 0 ? stepIndex + 1 : 0
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
                          trackUri: currentState?.item?.uri ?? playlist.tracks.items[0].track.uri,
                          position: currentState?.progress_ms ?? 0
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
                    trackUri: currentState?.item?.uri,
                    position: currentState?.progress_ms ?? 0
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
                  if (!deviceId) {
                    throw new Error('No device ID available for transfer')
                  }
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
                  if (!deviceId) {
                    throw new Error('No device ID available for playback')
                  }
                  const spotifyApi = SpotifyApiService.getInstance()
                  await spotifyApi.resumePlaybackAtPosition({
                    deviceId,
                    contextUri: `spotify:playlist:${fixedPlaylistId}`,
                    position: currentState?.progress_ms ?? 0
                  })
                } else if (
                  verificationResult.details?.progressAdvancing === false
                ) {
                  console.log('[Recovery] Retrying with next track')
                  if (!deviceId) {
                    throw new Error('No device ID available for skipping')
                  }
                  await sendApiRequest({
                    path: `me/player/next?device_id=${deviceId}`,
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
        onHealthStatusUpdate({ device: 'disconnected' })
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
        onHealthStatusUpdate({ device: 'unresponsive' })
      } else if (
        errorType.includes('device') ||
        errorType.includes('transfer')
      ) {
        recoveryErrorType = ErrorType.DEVICE
        onHealthStatusUpdate({ device: 'disconnected' })
      } else if (
        errorType.includes('network') ||
        errorType.includes('connection')
      ) {
        recoveryErrorType = ErrorType.CONNECTION
        onHealthStatusUpdate({ device: 'unresponsive' })
      } else {
        onHealthStatusUpdate({ device: 'unknown' })
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

  const resumePlayback = useCallback(
    async (contextUri: string, targetDeviceId: string): Promise<void> => {
      try {
        updateState({
          status: {
            message: 'Validating playback request...',
            progress: 10,
            error: null
          }
        })

        // Validate the request
        const validationResult = await validatePlaybackStateWithDetails(
          fixedPlaylistId!,
          contextUri,
          0
        )
        if (!validationResult.isValid) {
          throw new Error(validationResult.error || 'Invalid playback request')
        }

        updateState({
          status: {
            message: 'Transferring playback to device...',
            progress: 30,
            error: null
          }
        })

        // Verify device transfer
        const transferResult = await verifyDeviceTransfer(targetDeviceId)
        if (!transferResult) {
          throw new Error('Failed to transfer playback to device')
        }

        updateState({
          status: {
            message: 'Resuming playback...',
            progress: 50,
            error: null
          }
        })

        // Resume playback
        const spotifyApi = SpotifyApiService.getInstance()
        const result = await spotifyApi.resumePlaybackAtPosition({
          deviceId: targetDeviceId,
          contextUri,
          trackUri: state.lastSuccessfulPlayback.trackUri ?? undefined,
          position: state.lastSuccessfulPlayback.position
        })

        if (!result.success) {
          throw new Error('Failed to resume playback')
        }

        updateState({
          status: {
            message: 'Verifying playback...',
            progress: 70,
            error: null
          }
        })

        // Verify playback resumed correctly
        const verificationResult = await verifyPlaybackResume(
          contextUri,
          targetDeviceId
        )
        if (!verificationResult.isSuccessful) {
          throw new Error(verificationResult.reason)
        }

        updateState({
          lastSuccessfulPlayback: {
            trackUri: contextUri,
            position: 0,
            timestamp: Date.now()
          },
          consecutiveFailures: 0,
          lastErrorType: null,
          status: {
            message: 'Playback resumed successfully',
            progress: 100,
            error: null
          }
        })

        onHealthStatusUpdate({ device: 'healthy' })
      } catch (error) {
        console.error('[Recovery] Failed to resume playback:', error)
        updateState({
          status: {
            message: 'Failed to resume playback',
            progress: 100,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        })
        throw error
      }
    },
    [fixedPlaylistId, onHealthStatusUpdate, updateState]
  )

  return {
    state,
    attemptRecovery,
    updateState,
    resetCircuitBreaker,
    resumePlayback
  }
}
