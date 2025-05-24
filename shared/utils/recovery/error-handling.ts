import { sendApiRequest } from '@/shared/api'
import { ErrorRecoveryState, ErrorType } from '@/shared/types/recovery'
import { RECOVERY_COOLDOWN, ERROR_MESSAGES } from '@/shared/constants/recovery'
import {
  transferPlaybackToDevice,
  verifyDeviceTransfer
} from '@/services/deviceManagement'
import { useRecoverySystem } from '@/hooks/recovery/useRecoverySystem'

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
  try {
    // Use the unified recovery system
    const { recover } = useRecoverySystem(deviceId, fixedPlaylistId, () => {})
    await recover()
    return true
  } catch (recoveryError) {
    console.error('[Error Recovery] Recovery failed:', recoveryError)
    return false
  }
}
