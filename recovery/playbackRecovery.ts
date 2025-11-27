import { createModuleLogger } from '@/shared/utils/logger'
import { categorizeNetworkError, isNetworkError } from '@/shared/utils/networkErrorDetection'
import { queueManager } from '@/services/queueManager'
import { SpotifyApiService } from '@/services/spotifyApi'
import { spotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { transferPlaybackToDevice } from '@/services/deviceManagement/deviceTransfer'
import { buildTrackUri } from '@/shared/utils/spotifyUri'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type {
  RecoveryStrategy,
  RecoveryResult
} from '@/types/playbackRecovery'

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
    const errorMessage =
      error instanceof Error ? error.message : String(error)
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
 * Attempts to play the next track from the queue
 */
async function playNextTrackFromQueue(
  deviceId: string | null,
  skipCount: number = 0
): Promise<{ success: boolean; error?: Error; skippedTrack?: JukeboxQueueItem }> {
  if (!deviceId) {
    return {
      success: false,
      error: new Error('No device ID available for recovery')
    }
  }

  if (skipCount >= MAX_TRACK_SKIPS) {
    return {
      success: false,
      error: new Error(
        `Maximum track skips (${MAX_TRACK_SKIPS}) reached during recovery`
      )
    }
  }

  const nextTrack = queueManager.getNextTrack()

  if (!nextTrack) {
    return {
      success: false,
      error: new Error('No tracks available in queue for recovery')
    }
  }

  try {
    // Transfer playback to device first
    const transferred = await transferPlaybackToDevice(deviceId)
    if (!transferred) {
      return {
        success: false,
        error: new Error(
          `Failed to transfer playback to device: ${deviceId}`
        )
      }
    }

    const trackUri = buildTrackUri(nextTrack.tracks.spotify_track_id)

    logger(
      'INFO',
      `Attempting to play next track from queue: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id}), Queue ID: ${nextTrack.id}`
    )

    await sendApiRequest({
      path: 'me/player/play',
      method: 'PUT',
      body: {
        device_id: deviceId,
        uris: [trackUri]
      }
    })

    // Update queue manager with currently playing track
    queueManager.setCurrentlyPlayingTrack(nextTrack.tracks.spotify_track_id)

    logger(
      'INFO',
      `Successfully started playback of next track: ${nextTrack.tracks.name}`
    )

    return { success: true, skippedTrack: nextTrack }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error)

    // Handle "Restriction violated" errors by removing the problematic track
    if (
      error instanceof Error &&
      errorMessage.includes('Restriction violated')
    ) {
      logger(
        'WARN',
        `Restriction violated for track: ${nextTrack.tracks.name} (ID: ${nextTrack.id}), removing from queue`
      )

      try {
        await queueManager.markAsPlayed(nextTrack.id)
        // Try next track recursively
        return playNextTrackFromQueue(deviceId, skipCount + 1)
      } catch (markError) {
        logger(
          'ERROR',
          `Failed to remove problematic track: ${markError instanceof Error ? markError.message : String(markError)}`,
          undefined,
          markError instanceof Error ? markError : undefined
        )
        return {
          success: false,
          error: markError instanceof Error ? markError : new Error(String(markError))
        }
      }
    }

    logger(
      'ERROR',
      `Failed to play next track: ${errorMessage}`,
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
  addLog?: (level: 'INFO' | 'WARN' | 'ERROR', message: string, context?: string, error?: Error) => void
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
      nextAttemptAllowedAt: Date.now() + calculateCooldown(consecutiveFailures + 1)
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
      logger('WARN', `Network error detected, skipping recovery: ${categorized.message}`)
      if (addLog) {
        addLog('WARN', `Network error detected, skipping recovery: ${categorized.message}`, 'PlaybackRecovery', networkError)
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
      logger('WARN', `Network error during resume, skipping next strategy: ${categorized.message}`)
      if (addLog) {
        addLog('WARN', `Network error during resume: ${categorized.message}`, 'PlaybackRecovery', resumeResult.error)
      }
      return {
        success: false,
        strategy: 'resume_current',
        error: resumeResult.error,
        consecutiveFailures: consecutiveFailures + 1,
        nextAttemptAllowedAt: Date.now() + calculateCooldown(consecutiveFailures + 1)
      }
    }

    logger('WARN', 'Resume current track failed, trying next strategy: play_next')
  }

  // Strategy 2: Try to play next track from queue
  logger('INFO', 'Attempting recovery strategy: play_next')
  const playNextResult = await playNextTrackFromQueue(deviceId)

  if (playNextResult.success) {
    if (addLog) {
      const trackName = playNextResult.skippedTrack?.tracks.name || 'unknown'
      addLog(
        'INFO',
        `Playback recovery successful: playing next track ${trackName}`,
        'PlaybackRecovery'
      )
    }
    return {
      success: true,
      strategy: 'play_next',
      consecutiveFailures: 0
    }
  }

  // If play next failed due to network error, return early
  if (playNextResult.error && isNetworkError(playNextResult.error)) {
    const categorized = categorizeNetworkError(playNextResult.error)
    logger('WARN', `Network error during play next: ${categorized.message}`)
    if (addLog) {
      addLog('WARN', `Network error during play next: ${categorized.message}`, 'PlaybackRecovery', playNextResult.error)
    }
    return {
      success: false,
      strategy: 'play_next',
      error: playNextResult.error,
      consecutiveFailures: consecutiveFailures + 1,
      nextAttemptAllowedAt: Date.now() + calculateCooldown(consecutiveFailures + 1)
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

