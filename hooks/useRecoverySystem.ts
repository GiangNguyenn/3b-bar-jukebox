import { useState, useCallback, useRef } from 'react'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { executeWithErrorBoundary } from '@/shared/utils'

interface RecoveryState {
  lastSuccessfulPlayback: {
    trackUri: string | null
    position: number
    timestamp: number
  }
  consecutiveFailures: number
  lastErrorType: 'auth' | 'playback' | 'connection' | 'device' | null
}

interface RecoveryStatus {
  isRecovering: boolean
  message: string
  progress: number
}

interface PlaybackVerificationResult {
  isSuccessful: boolean
  reason?: string
  details?: {
    deviceMatch: boolean
    isPlaying: boolean
    progressAdvancing: boolean
    contextMatch: boolean
    currentTrack?: string
    expectedTrack?: string
    timestamp: number
    verificationDuration: number
  }
}

const MAX_RECOVERY_ATTEMPTS = 5
const BASE_DELAY = 2000 // 2 seconds

const RECOVERY_STEPS = [
  { message: 'Refreshing player state...', weight: 0.2 },
  { message: 'Ensuring active device...', weight: 0.2 },
  { message: 'Attempting to reconnect...', weight: 0.3 },
  { message: 'Reinitializing player...', weight: 0.3 }
]

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

export function useRecoverySystem(
  deviceId: string | null,
  fixedPlaylistId: string | null,
  onHealthStatusUpdate: (status: { device: string }) => void
) {
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>({
    isRecovering: false,
    message: '',
    progress: 0
  })
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null
  })
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error(
        '[Recovery] Max attempts reached, attempting final recovery...'
      )
      setRecoveryStatus({
        isRecovering: true,
        message: 'Attempting final recovery with stored state...',
        progress: 90
      })

      // Try one last recovery with stored state
      const lastState = recoveryState.lastSuccessfulPlayback
      if (lastState && Date.now() - lastState.timestamp < 300000) {
        // Within 5 minutes
        try {
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
          // If successful, reset recovery attempts
          setRecoveryAttempts(0)
          setRecoveryStatus({
            isRecovering: false,
            message: 'Recovery successful!',
            progress: 100
          })
          return
        } catch (error) {
          console.error('[Recovery] Final recovery attempt failed:', error)
        }
      }

      // If we get here, reload the page
      setRecoveryStatus({
        isRecovering: true,
        message: 'All recovery attempts failed. Reloading page...',
        progress: 100
      })
      setTimeout(() => {
        window.location.reload()
      }, 2000)
      return
    }

    try {
      setRecoveryStatus({
        isRecovering: true,
        message: 'Starting recovery process...',
        progress: 0
      })

      let currentProgress = 0
      const updateProgress = (step: number, success: boolean): void => {
        currentProgress += RECOVERY_STEPS[step].weight * 100
        setRecoveryStatus((prev) => ({
          ...prev,
          message: `${RECOVERY_STEPS[step].message} ${success ? '✓' : '✗'}`,
          progress: Math.min(currentProgress, 100)
        }))
      }

      // Step 1: Refresh player state
      if (typeof window.refreshSpotifyPlayer === 'function') {
        try {
          await window.refreshSpotifyPlayer()
          updateProgress(0, true)
        } catch (error) {
          console.error('[Recovery] Failed to refresh player state:', error)
          updateProgress(0, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'device'
          }))
        }
      }

      // Step 2: Ensure active device
      try {
        // Get current playback state
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!currentState?.device?.id) {
          // No active device found, try to transfer playback
          if (deviceId) {
            await sendApiRequest({
              path: 'me/player',
              method: 'PUT',
              body: {
                device_ids: [deviceId],
                play: false
              }
            })
            // Wait for transfer to take effect
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Verify transfer was successful
            const newState = await sendApiRequest<SpotifyPlaybackState>({
              path: 'me/player',
              method: 'GET'
            })

            if (newState?.device?.id === deviceId) {
              updateProgress(1, true)
            } else {
              throw new Error('Device transfer failed')
            }
          } else {
            throw new Error('No device ID available')
          }
        } else {
          updateProgress(1, true)
        }
      } catch (error) {
        console.error('[Recovery] Failed to ensure active device:', error)
        updateProgress(1, false)
        setRecoveryState((prev) => ({
          ...prev,
          consecutiveFailures: prev.consecutiveFailures + 1,
          lastErrorType: 'device'
        }))
      }

      // Step 3: Reconnect player
      if (typeof window.spotifyPlayerInstance?.connect === 'function') {
        try {
          await window.spotifyPlayerInstance.connect()
          updateProgress(2, true)
        } catch (error) {
          console.error('[Recovery] Failed to reconnect player:', error)
          updateProgress(2, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'connection'
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
          if (currentState?.item?.uri) {
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: currentState.progress_ms ?? 0,
                offset: { uri: currentState.item.uri }
              },
              debounceTime: 60000 // 1 minute debounce
            })
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
        } catch (error) {
          console.error('[Recovery] Failed to reinitialize player:', error)
          updateProgress(3, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'playback'
          }))
        }
      }

      // If we get here, recovery was successful
      onHealthStatusUpdate({ device: 'healthy' })
      setRecoveryAttempts(0)
      setRecoveryState((prev) => ({
        ...prev,
        consecutiveFailures: 0,
        lastErrorType: null
      }))
      setRecoveryStatus({
        isRecovering: false,
        message: 'Recovery successful!',
        progress: 100
      })

      // Clear recovery status after 3 seconds
      setTimeout(() => {
        setRecoveryStatus({
          isRecovering: false,
          message: '',
          progress: 0
        })
      }, 3000)
    } catch (error) {
      console.error('[Recovery] Failed:', error)
      setRecoveryAttempts((prev) => prev + 1)
      setRecoveryState((prev) => ({
        ...prev,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastErrorType: 'playback'
      }))

      // Calculate delay with exponential backoff
      const delay = BASE_DELAY * Math.pow(2, recoveryAttempts)
      recoveryTimeout.current = setTimeout(() => {
        void attemptRecovery()
      }, delay)
    }
  }, [
    recoveryAttempts,
    fixedPlaylistId,
    deviceId,
    recoveryState,
    onHealthStatusUpdate
  ])

  return {
    recoveryStatus,
    recoveryState,
    recoveryAttempts,
    attemptRecovery,
    setRecoveryState
  }
} 