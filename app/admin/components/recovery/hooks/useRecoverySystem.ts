import { useState, useCallback, useEffect } from 'react'
import { RecoveryState, RecoveryStatus } from '@/shared/types/recovery'
import { RECOVERY_STEPS, ERROR_MESSAGES } from '@/shared/constants/recovery'
import {
  createRecoveryState,
  createRecoveryStatus,
  cleanupRecoveryResources,
  cleanupPlaybackState
} from '../utils/state-management'
import {
  determineErrorType,
  handleErrorRecovery
} from '../utils/error-handling'
import { verifyDeviceTransfer } from '@/services/deviceManagement'
import { verifyPlaybackResume } from '../utils/playback-verification'
import { validatePlaybackRequest } from '../utils/validation'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { SpotifyApiService } from '@/services/spotifyApi'

interface ExtendedRecoveryState extends RecoveryState {
  currentDeviceId: string | null
  fixedPlaylistId: string | null
}

interface RecoverySystemHook {
  recoveryState: ExtendedRecoveryState
  recoveryStatus: RecoveryStatus
  error: string | null
  attemptRecovery: (error: Error) => Promise<void>
  resumePlayback: (contextUri: string, deviceId: string) => Promise<void>
}

export function useRecoverySystem(): RecoverySystemHook {
  const [recoveryState, setRecoveryState] = useState<ExtendedRecoveryState>({
    ...createRecoveryState(),
    currentDeviceId: null,
    fixedPlaylistId: null
  })
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(
    createRecoveryStatus()
  )
  const [error, setError] = useState<string | null>(null)

  const {
    refreshPlayerState,
    refreshPlaylistState,
    reconnectPlayer,
    checkPlayerReady,
    deviceId,
    isReady
  } = useSpotifyPlayerState(recoveryState.fixedPlaylistId ?? '')

  const updateStatus = useCallback(
    (message: string, progress: number, currentStep: number): void => {
      setRecoveryStatus((prev) => ({
        ...prev,
        message,
        progress,
        currentStep,
        totalSteps: RECOVERY_STEPS.length
      }))
    },
    []
  )

  const handleRecoveryError = useCallback((error: Error): void => {
    const errorType = determineErrorType(error)
    setError(error.message)
    setRecoveryState((prev) => ({
      ...prev,
      lastErrorType: errorType,
      consecutiveFailures: (prev.consecutiveFailures || 0) + 1
    }))
    throw error
  }, [])

  const attemptRecovery = useCallback(
    async (error: Error): Promise<void> => {
      try {
        setRecoveryStatus((prev) => ({ ...prev, isRecovering: true }))
        updateStatus('Starting recovery process...', 0, 0)

        // First try to refresh player state
        updateStatus('Refreshing player state...', 20, 1)
        await refreshPlayerState()

        // If that doesn't work, try reconnecting
        if (!isReady) {
          updateStatus('Reconnecting player...', 40, 2)
          await reconnectPlayer()
        }

        // Check if player is ready
        updateStatus('Checking player readiness...', 60, 3)
        const isPlayerReady = await checkPlayerReady()
        if (!isPlayerReady) {
          throw new Error('Player failed to become ready')
        }

        // Refresh playlist state
        updateStatus('Refreshing playlist state...', 80, 4)
        await refreshPlaylistState()

        // Verify the recovery was successful
        const recoveryResult = await handleErrorRecovery(
          error,
          deviceId,
          recoveryState.fixedPlaylistId
        )

        if (recoveryResult) {
          setRecoveryState((prev) => ({
            ...prev,
            lastErrorType: null,
            consecutiveFailures: 0,
            lastSuccessfulPlayback: {
              trackUri: null,
              position: 0,
              timestamp: Date.now()
            }
          }))
          updateStatus('Recovery successful', 100, RECOVERY_STEPS.length)
        } else {
          handleRecoveryError(new Error('Recovery failed'))
        }
      } catch (error) {
        handleRecoveryError(
          error instanceof Error
            ? error
            : new Error('Unknown error during recovery')
        )
      } finally {
        setRecoveryStatus((prev) => ({ ...prev, isRecovering: false }))
      }
    },
    [
      recoveryState,
      updateStatus,
      handleRecoveryError,
      refreshPlayerState,
      reconnectPlayer,
      checkPlayerReady,
      refreshPlaylistState,
      deviceId,
      isReady
    ]
  )

  const resumePlayback = useCallback(
    async (contextUri: string, deviceId: string): Promise<void> => {
      try {
        updateStatus('Validating playback request...', 10, 1)
        const validationResult = validatePlaybackRequest(contextUri, 0)
        if (!validationResult.isValid) {
          throw new Error(validationResult.errors.join(', '))
        }

        updateStatus('Transferring playback to device...', 30, 2)
        const transferResult = await verifyDeviceTransfer(deviceId)
        if (!transferResult) {
          throw new Error(ERROR_MESSAGES.DEVICE_TRANSFER_FAILED)
        }

        updateStatus('Resuming playback...', 50, 3)
        const spotifyApi = SpotifyApiService.getInstance()
        const result = await spotifyApi.resumePlaybackAtPosition({
          deviceId,
          contextUri,
          position: 0
        })

        if (!result.success) {
          throw new Error('Failed to resume playback')
        }

        updateStatus('Verifying playback...', 70, 4)
        const verificationResult = await verifyPlaybackResume(
          contextUri,
          deviceId,
          undefined,
          undefined
        )
        if (!verificationResult.isSuccessful) {
          throw new Error(verificationResult.reason)
        }

        setRecoveryState((prev) => ({
          ...prev,
          lastSuccessfulPlayback: {
            trackUri: contextUri,
            position: 0,
            timestamp: Date.now()
          },
          consecutiveFailures: 0,
          lastErrorType: null
        }))
        updateStatus(
          'Playback resumed successfully',
          100,
          RECOVERY_STEPS.length
        )
      } catch (error) {
        handleRecoveryError(
          error instanceof Error
            ? error
            : new Error('Unknown error during playback resume')
        )
      }
    },
    [updateStatus, handleRecoveryError]
  )

  useEffect(() => {
    return (): void => {
      void cleanupRecoveryResources()
      void cleanupPlaybackState()
    }
  }, [])

  return {
    recoveryState,
    recoveryStatus,
    error,
    attemptRecovery,
    resumePlayback
  }
}
