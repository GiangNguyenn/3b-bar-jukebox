import { createModuleLogger } from '@/shared/utils/logger'
import {
  categorizeNetworkError,
  isNetworkError
} from '@/shared/utils/networkErrorDetection'
import { transferPlaybackToDevice } from '@/services/deviceManagement/deviceTransfer'
import { getPlaybackState } from '@/services/deviceManagement/deviceApi'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

const logger = createModuleLogger('DeviceRecovery')

// Recovery configuration constants
const BASE_COOLDOWN_MS = 30000 // 30 seconds
const MAX_COOLDOWN_MS = 300000 // 5 minutes
const MAX_CONSECUTIVE_FAILURES = 5

/**
 * Calculates cooldown period based on consecutive failures
 */
function calculateCooldown(consecutiveFailures: number): number {
  if (consecutiveFailures >= 5) {
    return MAX_COOLDOWN_MS
  }
  if (consecutiveFailures >= 3) {
    return 120000 // 2 minutes
  }
  return BASE_COOLDOWN_MS
}

/**
 * Checks if recovery should be attempted based on cooldown
 */
export function shouldAttemptDeviceRecovery(
  lastAttemptTimestamp: number,
  consecutiveFailures: number
): boolean {
  const cooldown = calculateCooldown(consecutiveFailures)
  const timeSinceLastAttempt = Date.now() - lastAttemptTimestamp
  return timeSinceLastAttempt >= cooldown
}

export interface DeviceRecoveryResult {
  success: boolean
  skipped: boolean
  reason?: string
  error?: Error
  consecutiveFailures: number
  nextAttemptAllowedAt: number
}

/**
 * Attempts to recover device activation when device is not active
 * This will NOT interrupt music if it's currently playing on another device
 */
export async function attemptDeviceRecovery(
  deviceId: string,
  consecutiveFailures: number,
  addLog?: (
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) => void
): Promise<DeviceRecoveryResult> {
  if (!deviceId) {
    const error = new Error('Device ID not available for recovery')
    logger('ERROR', error.message)
    if (addLog) {
      addLog('ERROR', error.message, 'DeviceRecovery', error)
    }
    return {
      success: false,
      skipped: false,
      error,
      consecutiveFailures: consecutiveFailures + 1,
      nextAttemptAllowedAt:
        Date.now() + calculateCooldown(consecutiveFailures + 1)
    }
  }

  // Check if network is available (skip recovery if network is down)
  let networkError: Error | undefined
  try {
    // Quick network check by attempting to get playback state
    await getPlaybackState()
  } catch (error) {
    if (isNetworkError(error)) {
      networkError = error instanceof Error ? error : new Error(String(error))
      const categorized = categorizeNetworkError(error)

      // FAST RETRY LOGIC:
      // If it's a network error, we don't want to wait 30 seconds.
      // We want to retry quickly (e.g. 1s, 2s, 5s) because it might be a blip.
      // However, we don't want to spam.

      // If consecutive failures are low, use a short cooldown
      let nextAllowedAt = Date.now() + BASE_COOLDOWN_MS
      if (consecutiveFailures < 3) {
        nextAllowedAt = Date.now() + 2000 // Retry in 2 seconds for first few failures
      }

      logger(
        'WARN',
        `Network error detected, scheduling fast retry: ${categorized.message}`
      )
      if (addLog) {
        addLog(
          'WARN',
          `Network error detected, scheduling fast retry: ${categorized.message}`,
          'DeviceRecovery',
          networkError
        )
      }
      return {
        success: false,
        skipped: true,
        reason: 'Network error',
        error: networkError,
        consecutiveFailures, // Don't increment failures for transient network errors to avoid long backoff
        nextAttemptAllowedAt: nextAllowedAt
      }
    }
  }

  // Check current playback state to avoid interrupting music
  let playbackState: SpotifyPlaybackState | null = null
  try {
    playbackState = await getPlaybackState()
  } catch (error) {
    logger(
      'WARN',
      'Failed to get playback state for recovery check',
      undefined,
      error instanceof Error ? error : undefined
    )
    // Continue with recovery attempt even if we can't check playback state
  }

  // If music is playing on another device, skip recovery to avoid interruption
  if (playbackState?.is_playing && playbackState.device?.id !== deviceId) {
    const reason = `Music is playing on another device (${playbackState.device?.name || playbackState.device?.id}). Skipping recovery to avoid interruption.`
    logger('INFO', reason)
    if (addLog) {
      addLog('INFO', reason, 'DeviceRecovery')
    }
    return {
      success: false,
      skipped: true,
      reason: 'Music playing on another device',
      consecutiveFailures: 0, // Reset failures since this is intentional
      nextAttemptAllowedAt: Date.now() + BASE_COOLDOWN_MS
    }
  }

  // If music is playing on the target device, device is already active
  if (playbackState?.is_playing && playbackState.device?.id === deviceId) {
    const reason = 'Device is already active and playing music'
    logger('INFO', reason)
    if (addLog) {
      addLog('INFO', reason, 'DeviceRecovery')
    }
    return {
      success: true,
      skipped: false,
      reason,
      consecutiveFailures: 0,
      nextAttemptAllowedAt: Date.now() + BASE_COOLDOWN_MS
    }
  }

  // Safe to attempt device transfer (music is not playing or is paused)
  try {
    logger(
      'INFO',
      `Attempting to activate device ${deviceId} (no active playback detected)`
    )
    if (addLog) {
      addLog(
        'INFO',
        `Attempting to activate device ${deviceId} (no active playback detected)`,
        'DeviceRecovery'
      )
    }

    // Transfer playback to device (with shouldPlay: null to maintain current state)
    // We pass undefined for intermediate optional parameters to use their defaults
    const transferred = await transferPlaybackToDevice(
      deviceId,
      undefined,
      undefined,
      undefined,
      null
    )

    if (transferred) {
      logger('INFO', `Device ${deviceId} successfully activated`)
      if (addLog) {
        addLog(
          'INFO',
          `Device ${deviceId} successfully activated`,
          'DeviceRecovery'
        )
      }
      return {
        success: true,
        skipped: false,
        consecutiveFailures: 0,
        nextAttemptAllowedAt: Date.now() + BASE_COOLDOWN_MS
      }
    } else {
      const error = new Error('Device transfer failed')
      logger('WARN', error.message)
      if (addLog) {
        addLog('WARN', error.message, 'DeviceRecovery', error)
      }
      return {
        success: false,
        skipped: false,
        error,
        consecutiveFailures: consecutiveFailures + 1,
        nextAttemptAllowedAt:
          Date.now() + calculateCooldown(consecutiveFailures + 1)
      }
    }
  } catch (error) {
    const recoveryError =
      error instanceof Error ? error : new Error(String(error))
    logger('ERROR', 'Device recovery failed', undefined, recoveryError)
    if (addLog) {
      addLog('ERROR', 'Device recovery failed', 'DeviceRecovery', recoveryError)
    }
    return {
      success: false,
      skipped: false,
      error: recoveryError,
      consecutiveFailures: consecutiveFailures + 1,
      nextAttemptAllowedAt:
        Date.now() + calculateCooldown(consecutiveFailures + 1)
    }
  }
}
