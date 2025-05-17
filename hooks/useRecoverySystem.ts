import { useState, useCallback, useRef, useEffect } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { executeWithErrorBoundary } from '@/shared/utils/errorBoundary'
import { SpotifyApiService } from '@/services/spotifyApi'
import {
  RecoveryState,
  RecoveryStatus,
  PlaybackVerificationResult,
  ErrorType,
  RECOVERY_CONSTANTS,
  validateRecoveryState,
  DeviceVerificationState
} from '@/shared/types/recovery'

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

const RECOVERY_STEPS = [
  { message: 'Refreshing player state...', weight: 0.2 },
  { message: 'Ensuring active device...', weight: 0.2 },
  { message: 'Attempting to reconnect...', weight: 0.3 },
  { message: 'Reinitializing player...', weight: 0.3 }
]

const MAX_RECOVERY_ATTEMPTS = 5
const BASE_DELAY = 2000 // 2 seconds
const VERIFICATION_LOCK_TIMEOUT = 5000 // 5 seconds
const DEVICE_TRANSFER_TIMEOUT = 5000 // 5 seconds
const DEVICE_TRANSFER_RETRIES = 3
const PLAYBACK_VERIFICATION_RETRIES = 3
const MIN_VOLUME = 20 // Minimum volume level to ensure audio is audible

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

async function transferPlaybackToDevice(
  deviceId: string,
  retries: number = DEVICE_TRANSFER_RETRIES
): Promise<DeviceTransferResult> {
  console.log('[Device Transfer] Starting transfer to device:', {
    deviceId,
    retries,
    timestamp: new Date().toISOString()
  })

  // First check if device is already active
  try {
    const currentState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    if (currentState?.device?.id === deviceId) {
      console.log('[Device Transfer] Device already active:', {
        deviceId,
        timestamp: new Date().toISOString()
      })
      return { success: true, deviceId }
    }
  } catch (error) {
    console.error('[Device Transfer] Failed to check current device:', error)
  }

  // Attempt transfer with exponential backoff
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`[Device Transfer] Attempt ${attempt + 1}/${retries}:`, {
        deviceId,
        timestamp: new Date().toISOString()
      })

      // Wait with exponential backoff before attempt
      const waitTime = Math.min(
        1000 * Math.pow(2, attempt),
        DEVICE_TRANSFER_TIMEOUT
      )
      await new Promise((resolve) => setTimeout(resolve, waitTime))

      // Attempt transfer
      await sendApiRequest({
        path: 'me/player',
        method: 'PUT',
        body: {
          device_ids: [deviceId],
          play: false
        }
      })

      // Wait for transfer to take effect
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Verify transfer was successful
      const verifyState = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (verifyState?.device?.id === deviceId) {
        console.log('[Device Transfer] Transfer successful:', {
          deviceId,
          attempt: attempt + 1,
          timestamp: new Date().toISOString()
        })

        // Additional verification that device is ready
        if (verifyState.device.is_active) {
          return { success: true, deviceId }
        } else {
          console.log('[Device Transfer] Device not active yet, waiting...')
          // Wait a bit longer for device to become active
          await new Promise((resolve) => setTimeout(resolve, 3000))

          const finalState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          if (
            finalState?.device?.id === deviceId &&
            finalState.device.is_active
          ) {
            return { success: true, deviceId }
          }
        }
      }

      console.log('[Device Transfer] Transfer verification failed:', {
        expected: deviceId,
        actual: verifyState?.device?.id,
        isActive: verifyState?.device?.is_active,
        attempt: attempt + 1,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      console.error(`[Device Transfer] Attempt ${attempt + 1} failed:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        deviceId,
        timestamp: new Date().toISOString()
      })

      // If we get a 404, the device might not exist anymore
      if (error instanceof Error && error.message.includes('404')) {
        return {
          success: false,
          deviceId: null,
          error: 'Device not found'
        }
      }

      // If we get a 403, we might need to refresh the token
      if (error instanceof Error && error.message.includes('403')) {
        return {
          success: false,
          deviceId: null,
          error: 'Authentication error'
        }
      }
    }
  }

  console.error('[Device Transfer] All transfer attempts failed:', {
    deviceId,
    retries,
    timestamp: new Date().toISOString()
  })

  return {
    success: false,
    deviceId: null,
    error: 'Failed to transfer playback after multiple attempts'
  }
}

async function ensurePlaybackState(
  playlistId: string,
  trackUri: string | null,
  position: number
): Promise<boolean> {
  try {
    // Validate playlist and track
    const isPlaylistValid = await validatePlaylist(playlistId)
    if (!isPlaylistValid) {
      console.error('[Playback] Playlist is no longer available')
      return false
    }

    if (trackUri) {
      const isTrackValid = await validateTrack(trackUri)
      if (!isTrackValid) {
        console.error('[Playback] Track is no longer available')
        return false
      }
    }

    return true
  } catch (error) {
    console.error('[Playback] Failed to ensure playback state:', error)
    return false
  }
}

async function validatePlaybackState(
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

    if (state.attempts >= RECOVERY_CONSTANTS.MAX_RECOVERY_ATTEMPTS) {
      console.error(
        '[Recovery] Max attempts reached, attempting final recovery...'
      )
      transitionTo(
        'error',
        'Attempting final recovery with stored state...',
        90
      )

      // Try one last recovery with stored state
      const lastState = state.lastSuccessfulPlayback
      if (lastState && Date.now() - lastState.timestamp < 300000) {
        try {
          // Validate state before attempting recovery
          const validationResult = validateRecoveryState({
            lastSuccessfulPlayback: lastState,
            consecutiveFailures: state.consecutiveFailures,
            lastErrorType: state.lastErrorType
          })

          if (!validationResult.isValid) {
            throw new Error(
              `Invalid playback state: ${validationResult.errors.join(', ')}`
            )
          }

          console.log(
            '[Recovery] Attempting recovery with stored state:',
            lastState
          )
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: lastState.position,
              offset: { uri: lastState.trackUri }
            }
          })

          updateState({
            attempts: 0,
            phase: 'success',
            status: {
              message: 'Recovery successful!',
              progress: 100,
              error: null
            }
          })
          cleanupRecoveryState()
          return
        } catch (error) {
          console.error('[Recovery] Final recovery attempt failed:', error)
        }
      }

      transitionTo(
        'error',
        'All recovery attempts failed. Reloading page...',
        100
      )
      setTimeout(() => {
        window.location.reload()
      }, 2000)
      cleanupRecoveryState()
      return
    }

    isRecoveryInProgress.current = true

    try {
      transitionTo('initializing', 'Starting recovery process...', 0)

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

      // Step 1: Refresh player state
      if (typeof window.refreshSpotifyPlayer === 'function') {
        try {
          await window.refreshSpotifyPlayer()
          updateProgress(0, true)
        } catch (error) {
          console.error('[Recovery] Failed to refresh player state:', error)
          updateProgress(0, false)
          updateState((prev) => ({
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: ErrorType.DEVICE
          }))
        }
      }

      // Step 2: Ensure active device with improved transfer logic
      if (deviceId) {
        const transferResult = await transferPlaybackToDevice(deviceId)
        if (transferResult.success) {
          updateProgress(1, true)
        } else {
          console.error(
            '[Recovery] Device transfer failed:',
            transferResult.error
          )
          updateProgress(1, false)
          updateState((prev) => ({
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: ErrorType.DEVICE
          }))
        }
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

            const validationResult = await validatePlaybackState(
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
                  console.error('[Recovery] Failed to get first track:', error)
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

            // Verify again after retry
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

          console.log('[Recovery] Recovery successful, cleaning up state')
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
          cleanupRecoveryState()
          return
        } catch (error) {
          console.error('[Recovery] Failed to reinitialize player:', error)
          updateProgress(3, false)
          updateState((prev) => ({
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: ErrorType.PLAYBACK
          }))
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
      cleanupRecoveryState()
    } catch (error) {
      console.error('[Recovery] Failed:', error)
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

      // If we've reached max attempts, clean up and reload
      if (state.attempts >= RECOVERY_CONSTANTS.MAX_RECOVERY_ATTEMPTS) {
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
    updateState
  }
}
