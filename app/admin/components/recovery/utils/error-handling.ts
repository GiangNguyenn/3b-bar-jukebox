import { sendApiRequest } from '@/shared/api'
import { ErrorRecoveryState, ErrorType } from '@/shared/types/recovery'
import { RECOVERY_COOLDOWN, ERROR_MESSAGES } from '@/shared/constants/recovery'
import {
  transferPlaybackToDevice,
  verifyDeviceTransfer
} from '@/services/deviceManagement'

const errorRecoveryState: ErrorRecoveryState = {
  lastError: null,
  errorCount: 0,
  lastRecoveryAttempt: 0,
  recoveryInProgress: false
}

export function determineErrorType(error: unknown): ErrorType {
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

export async function handleErrorRecovery(
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
