import { createModuleLogger } from '@/shared/utils/logger'
import {
  categorizeNetworkError,
  isNetworkError
} from '@/shared/utils/networkErrorDetection'
import { queueManager } from '@/services/queueManager'
import { SpotifyApiService } from '@/services/spotifyApi'
import { spotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { transferPlaybackToDevice } from '@/services/deviceManagement/deviceTransfer'
import { buildTrackUri } from '@/shared/utils/spotifyUri'
import { playerLifecycleService } from '@/services/playerLifecycle'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type { RecoveryStrategy, RecoveryResult } from '@/types/playbackRecovery'

const logger = createModuleLogger('PlaybackRecovery')

// Recovery configuration constants
const MAX_RECOVERY_ATTEMPTS = 3
const MAX_TRACK_SKIPS = 3
const BASE_COOLDOWN_MS = 15000 // 15 seconds
const MAX_COOLDOWN_MS = 60000 // 60 seconds
const MAX_CONSECUTIVE_FAILURES = 5

/**
 * Calculates cooldown period based on consecutive failures
 */
function calculateCooldown(consecutiveFailures: number): number {
  if (consecutiveFailures >= 5) {
    return MAX_COOLDOWN_MS
  }
  if (consecutiveFailures >= 3) {
    return 30000 // 30 seconds
  }
  return BASE_COOLDOWN_MS
}

/**
 * Checks if recovery should be attempted based on cooldown
 */
export function shouldAttemptRecovery(
  lastAttemptTimestamp: number,
  consecutiveFailures: number
): boolean {
  const cooldown = calculateCooldown(consecutiveFailures)
  const timeSinceLastAttempt = Date.now() - lastAttemptTimestamp
  return timeSinceLastAttempt >= cooldown
}

/**
 * Attempts to resume playback of the current track
 */
async function resumeCurrentTrack(
  currentPlaybackState: SpotifyPlaybackState | null,
  deviceId: string | null
): Promise<{ success: boolean; error?: Error }> {
  if (!deviceId) {
    return {
      success: false,
      error: new Error('No device ID available for recovery')
    }
  }

  if (!currentPlaybackState?.item) {
    return {
      success: false,
      error: new Error('No current track available to resume')
    }
  }

  try {
    const spotifyApi = SpotifyApiService.getInstance()
    const currentPosition = currentPlaybackState.progress_ms || 0

    logger(
      'INFO',
      `Attempting to resume current track: ${currentPlaybackState.item.name} at position ${currentPosition}ms`
    )

    const result = await spotifyApi.resumePlayback(currentPosition, deviceId)

    if (result.success) {
      logger(
        'INFO',
        `Successfully resumed playback of current track: ${currentPlaybackState.item.name}`
      )
      return { success: true }
    }

    return {
      success: false,
      error: new Error('Resume playback returned success: false')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger(
      'ERROR',
      `Failed to resume current track: ${errorMessage}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    }
  }
}

/**
 * Main recovery entry point
 * Attempts to recover playback when it stops unexpectedly
 */
export async function attemptPlaybackRecovery(
  currentPlaybackState: SpotifyPlaybackState | null,
  consecutiveFailures: number,
  addLog?: (
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    context?: string,
    error?: Error
  ) => void
): Promise<RecoveryResult> {
  const deviceId = spotifyPlayerStore.getState().deviceId

  // Check device availability
  if (!deviceId) {
    const error = new Error('Device ID not available for recovery')
    logger('ERROR', error.message)
    if (addLog) {
      addLog('ERROR', error.message, 'PlaybackRecovery', error)
    }
    return {
      success: false,
      strategy: 'none',
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
    await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
  } catch (error) {
    if (isNetworkError(error)) {
      networkError = error instanceof Error ? error : new Error(String(error))
      const categorized = categorizeNetworkError(error)
      logger(
        'WARN',
        `Network error detected, skipping recovery: ${categorized.message}`
      )
      if (addLog) {
        addLog(
          'WARN',
          `Network error detected, skipping recovery: ${categorized.message}`,
          'PlaybackRecovery',
          networkError
        )
      }
      return {
        success: false,
        strategy: 'none',
        error: networkError,
        consecutiveFailures,
        nextAttemptAllowedAt: Date.now() + BASE_COOLDOWN_MS
      }
    }
  }

  // Strategy 1: Try to resume current track if available
  if (currentPlaybackState?.item) {
    logger('INFO', 'Attempting recovery strategy: resume_current')
    const resumeResult = await resumeCurrentTrack(
      currentPlaybackState,
      deviceId
    )

    if (resumeResult.success) {
      if (addLog) {
        addLog(
          'INFO',
          `Playback recovery successful: resumed current track ${currentPlaybackState.item.name}`,
          'PlaybackRecovery'
        )
      }
      return {
        success: true,
        strategy: 'resume_current',
        consecutiveFailures: 0
      }
    }

    // If resume failed due to network error, don't try next strategy
    if (resumeResult.error && isNetworkError(resumeResult.error)) {
      const categorized = categorizeNetworkError(resumeResult.error)
      logger(
        'WARN',
        `Network error during resume, skipping next strategy: ${categorized.message}`
      )
      if (addLog) {
        addLog(
          'WARN',
          `Network error during resume: ${categorized.message}`,
          'PlaybackRecovery',
          resumeResult.error
        )
      }
      return {
        success: false,
        strategy: 'resume_current',
        error: resumeResult.error,
        consecutiveFailures: consecutiveFailures + 1,
        nextAttemptAllowedAt:
          Date.now() + calculateCooldown(consecutiveFailures + 1)
      }
    }

    logger(
      'WARN',
      'Resume current track failed, trying next strategy: play_next'
    )
  }

  // Strategy 2: Try to play next track from queue via PlayerLifecycleService
  logger('INFO', 'Attempting recovery strategy: play_next')

  const nextTrack = queueManager.getNextTrack()

  if (!nextTrack) {
    const noTrackError = new Error('No tracks available in queue for recovery')
    logger('WARN', noTrackError.message)
    if (addLog) {
      addLog('WARN', noTrackError.message, 'PlaybackRecovery', noTrackError)
    }
    return {
      success: false,
      strategy: 'play_next',
      error: noTrackError,
      consecutiveFailures: consecutiveFailures + 1,
      nextAttemptAllowedAt:
        Date.now() + calculateCooldown(consecutiveFailures + 1)
    }
  }

  try {
    await playerLifecycleService.playNextFromQueue()

    if (addLog) {
      addLog(
        'INFO',
        `Playback recovery successful: playing next track ${nextTrack.tracks.name}`,
        'PlaybackRecovery'
      )
    }

    return {
      success: true,
      strategy: 'play_next',
      consecutiveFailures: 0
    }
  } catch (error) {
    const errorInstance =
      error instanceof Error ? error : new Error(String(error))

    // If play next failed due to network error, return early with cooldown
    if (isNetworkError(errorInstance)) {
      const categorized = categorizeNetworkError(errorInstance)
      logger('WARN', `Network error during play next: ${categorized.message}`)
      if (addLog) {
        addLog(
          'WARN',
          `Network error during play next: ${categorized.message}`,
          'PlaybackRecovery',
          errorInstance
        )
      }
      return {
        success: false,
        strategy: 'play_next',
        error: errorInstance,
        consecutiveFailures: consecutiveFailures + 1,
        nextAttemptAllowedAt:
          Date.now() + calculateCooldown(consecutiveFailures + 1)
      }
    }

    logger(
      'ERROR',
      `Failed to play next track via PlayerLifecycleService: ${errorInstance.message}`,
      undefined,
      errorInstance
    )

    return {
      success: false,
      strategy: 'play_next',
      error: errorInstance,
      consecutiveFailures: consecutiveFailures + 1,
      nextAttemptAllowedAt:
        Date.now() + calculateCooldown(consecutiveFailures + 1)
    }
  }

  // All strategies failed
  const newConsecutiveFailures = consecutiveFailures + 1
  const cooldown = calculateCooldown(newConsecutiveFailures)
  const nextAttemptAllowedAt = Date.now() + cooldown

  logger(
    'ERROR',
    `All recovery strategies failed. Consecutive failures: ${newConsecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}. Next attempt allowed at: ${new Date(nextAttemptAllowedAt).toISOString()}`,
    undefined,
    playNextResult.error
  )

  if (addLog) {
    addLog(
      'ERROR',
      `Playback recovery failed after all strategies. Consecutive failures: ${newConsecutiveFailures}`,
      'PlaybackRecovery',
      playNextResult.error
    )
  }

  // If max consecutive failures reached, stop auto-recovery
  if (newConsecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    logger(
      'ERROR',
      `Maximum consecutive failures (${MAX_CONSECUTIVE_FAILURES}) reached. Auto-recovery disabled. Manual intervention required.`
    )
    if (addLog) {
      addLog(
        'ERROR',
        `Maximum consecutive failures (${MAX_CONSECUTIVE_FAILURES}) reached. Auto-recovery disabled.`,
        'PlaybackRecovery'
      )
    }
  }

  return {
    success: false,
    strategy: 'play_next',
    error: playNextResult.error,
    consecutiveFailures: newConsecutiveFailures,
    nextAttemptAllowedAt
  }
}
