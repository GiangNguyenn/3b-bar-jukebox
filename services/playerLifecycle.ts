import { sendApiRequest } from '@/shared/api'
import {
  validateDevice,
  transferPlaybackToDevice,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { upsertPlayedTrack } from '@/lib/trackUpsert'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'
import { PLAYER_LIFECYCLE_CONFIG } from './playerLifecycleConfig'
import { LogEntry } from '@/shared/types/health'
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import { buildTrackUri } from '@/shared/utils/spotifyUri'
import {
  ensureTrackNotDuplicate,
  withErrorHandling,
  TimeoutManager
} from './playerLifecycle/utils'
import {
  spotifyPlayer,
  playbackService,
  recoveryManager
} from '@/services/player'

// Type for internal SDK state tracking - composed instead of extended
// to properly represent the actual SDK state structure
interface PlayerSDKState {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: {
      id: string
      uri: string
      name: string
      artists: Array<{ name: string }>
      album: {
        name: string
        images: Array<{ url: string }>
      }
      duration_ms: number
    } | null
  }
  // Phase 3: Removed unused disallows field
}

// Type guard for runtime validation of PlayerSDKState
function isPlayerSDKState(state: unknown): state is PlayerSDKState {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  const paused = s.paused
  const position = s.position
  const duration = s.duration
  const trackWindow = s.track_window

  // Validate base properties
  if (
    typeof paused !== 'boolean' ||
    typeof position !== 'number' ||
    typeof duration !== 'number' ||
    !trackWindow ||
    typeof trackWindow !== 'object' ||
    !('current_track' in trackWindow)
  ) {
    return false
  }

  // Issue #11: Validate current_track structure if present
  const currentTrack = (trackWindow as Record<string, unknown>).current_track
  if (currentTrack !== null) {
    if (
      typeof currentTrack !== 'object' ||
      !('id' in currentTrack) ||
      !('uri' in currentTrack) ||
      !('name' in currentTrack)
    ) {
      return false
    }
  }

  return true
}

// Type for the navigation callback
export type NavigationCallback = (path: string) => void

/**
 * Phase 4: PlayerLifecycleService
 *
 * Manages the complete lifecycle of the Spotify Web Playback SDK player.
 * Responsibilities:
 * - Player initialization and teardown
 * - Device state management and recovery
 * - Queue playback orchestration
 * - Error handling and retry logic
 * - State synchronization with Spotify SDK
 *
 * Key improvements:
 * - Queue-based state change processing to prevent race conditions
 * - Extracted event handlers for better testability
 * - Consistent error handling for all async operations
 * - Configuration-driven retry and timeout behavior
 *
 * @example
 * ```typescript
 * import { playerLifecycleService } from '@/services/playerLifecycle'
 *
 * // Initialize player
 * await playerLifecycleService.createPlayer(
 *   onStatusChange,
 *   onDeviceIdChange,
 *   onPlaybackStateChange
 * )
 *
 * // Play next track
 * await playerLifecycleService.playNextTrack()
 * ```
 */
class PlayerLifecycleService {
  private playerRef: Spotify.Player | null = null
  private lastKnownState: PlayerSDKState | null = null
  /**
   * Issue #8: State Management Documentation
   *
   * LOCAL state: The queue item currently being played by THIS player instance.
   * This is our internal tracking and may be null if playing external tracks.
   * Source of truth for: What WE started playing
   *
   * SHARED state: queueManager.currentlyPlayingTrack (set via setCurrentlyPlayingTrack)
   * Source of truth for: What Spotify is actually playing (track ID only)
   * Used by: Queue filtering to exclude currently playing tracks
   *
   * Synchronization pattern:
   * - Set when starting playback (line 315-320)
   * - Clear when track finishes (line 622)
   * - Sync on state changes (line 676, 691)
   */
  private currentQueueTrack: JukeboxQueueItem | null = null
  private deviceId: string | null = null
  /**
   * Tracks if the playback was paused manually by the user via the Jukebox UI.
   * This is used to differentiate between system-initiated pauses (errors, etc.)
   * and intentional user actions.
   */
  private isManualPause: boolean = false
  private timeoutManager: TimeoutManager = new TimeoutManager()
  // Phase 3: authRetryCount removed - using recoveryManager instead
  private duplicateDetector: TrackDuplicateDetector =
    new TrackDuplicateDetector()
  private addLog:
    | ((
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void)
    | null = null
  private navigationCallback: NavigationCallback | null = null
  private stateChangeInProgress: boolean = false
  private pendingStates: PlayerSDKState[] = [] // Queue for state changes that arrive during processing
  private readonly MAX_PENDING_STATES = 10 // Prevent memory issues during rapid state changes
  private consecutiveNullStates: number = 0

  // Phase 4: Internal Log History (Circular Buffer)
  private internalLogBuffer: LogEntry[] = []
  private readonly MAX_LOG_HISTORY = 100
  // Phase 1: Memory leak prevention
  private pendingPromiseCleanup: (() => void) | null = null
  // Phase 1: Playback operation locking
  // Phase 2: Lock variables removed - using playbackService for serialization
  // Phase 3: Track state tracking
  private lastStateUpdateTime: number = 0
  // Phase 2: Force recovery flag
  private isRecoveryNeeded: boolean = false
  // Phase 2: Device ready resolvers
  private deviceReadyResolver: ((deviceId: string) => void) | null = null
  private deviceErrorResolver: ((error: Error) => void) | null = null

  setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ): void {
    this.addLog = logger
    // Phase 1: Set logger for spotifyPlayer service
    spotifyPlayer.setLogger(logger)
    // Phase 2: Set logger for playbackService
    playbackService.setLogger(logger)
    // Phase 3: Set logger for recoveryManager
    recoveryManager.setLogger(logger)
    // Set logger for device management
    setDeviceManagementLogger(logger)
  }

  setNavigationCallback(callback: NavigationCallback | null): void {
    this.navigationCallback = callback
  }

  initializeQueue(): void {
    this.currentQueueTrack = queueManager.getNextTrack() ?? null
  }

  private log(level: LogLevel, message: string, error?: unknown): void {
    // Capture to internal buffer
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: level as LogEntry['level'],
      message,
      details:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error
    }

    this.internalLogBuffer.push(entry)
    if (this.internalLogBuffer.length > this.MAX_LOG_HISTORY) {
      this.internalLogBuffer.shift()
    }

    if (this.addLog) {
      this.addLog(
        level,
        message,
        'PlayerLifecycle',
        error instanceof Error ? error : undefined
      )
    } else {
      // Fallback: only log warnings and errors
      if (level === 'WARN') {
        console.warn(`[PlayerLifecycle] ${message}`, error)
      } else if (level === 'ERROR') {
        console.error(`[PlayerLifecycle] ${message}`, error)
      }
    }
  }

  // Phase 2: withPlaybackLock removed - using playbackService.executePlayback() instead

  private async playTrackWithRetry(
    trackUri: string,
    deviceId: string,
    maxRetries = PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxRetriesPerTrack
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.log(
          'INFO',
          `Playing track ${trackUri} on device ${deviceId} (attempt ${attempt + 1}/${maxRetries + 1})`
        )

        await sendApiRequest({
          path: `me/player/play?device_id=${deviceId}`,
          method: 'PUT',
          body: {
            uris: [trackUri]
          }
        })

        // Reset manual pause flag on successful playback start
        this.isManualPause = false

        return true
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        // Handle "Restriction violated" by skipping to next track
        if (errorMessage.includes('Restriction violated')) {
          this.log(
            'WARN',
            `Restriction violated for track ${trackUri}, skipping to next track`
          )
          return false // Don't retry, just skip this track
        }

        // If we've exhausted retries, fail
        if (attempt === maxRetries) {
          this.log(
            'ERROR',
            `Failed to play track ${trackUri} after ${maxRetries + 1} attempts`,
            error
          )
          return false
        }

        // Issue #9: Use config for exponential backoff
        const backoffMs =
          PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.initialBackoffMs *
          Math.pow(2, attempt)
        this.log(
          'WARN',
          `Playback attempt ${attempt + 1} failed, retrying in ${backoffMs}ms`,
          error
        )
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }
    return false
  }

  /**
   * Play next track from queue with retry logic and duplicate detection.
   * Phase 2: Uses playbackService for promise-chain serialization (no locks needed).
   */
  async playNextTrack(track: JukeboxQueueItem): Promise<void> {
    await playbackService.executePlayback(() => {
      // Reset manual pause flag when starting next track
      this.isManualPause = false
      return this.playNextTrackImpl(track)
    }, 'playNextTrack')
  }

  private async playNextTrackImpl(track: JukeboxQueueItem): Promise<void> {
    if (!this.deviceId) {
      this.log('ERROR', 'No device ID available to play next track')
      return
    }

    // Iterative approach: try tracks from queue until success or exhaustion
    const MAX_ATTEMPTS = PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxAttempts // Safety limit to prevent infinite loops
    let currentTrack: JukeboxQueueItem | null = track
    let attempts = 0

    // Phase 2: Use local state instead of API call (Issue #9)
    const lastPlayingTrackId =
      this.lastKnownState?.track_window?.current_track?.id ?? null

    // Phase 2: Loop detection (Issue #8)
    const seenTrackIds = new Set<string>()

    while (
      currentTrack &&
      attempts < MAX_ATTEMPTS &&
      !seenTrackIds.has(currentTrack.tracks.spotify_track_id)
    ) {
      attempts++
      seenTrackIds.add(currentTrack.tracks.spotify_track_id)

      this.log(
        'INFO',
        `[playNextTrack] Attempt ${attempts}/${MAX_ATTEMPTS} - Track: ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id}), Queue ID: ${currentTrack.id}`
      )

      // Check for duplicate if we have last playing track ID
      if (lastPlayingTrackId) {
        const validTrack = await ensureTrackNotDuplicate(
          currentTrack,
          lastPlayingTrackId,
          PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.duplicateCheckRetries,
          this.addLog ?? undefined
        )

        if (!validTrack) {
          this.log(
            'WARN',
            `Track ${currentTrack?.tracks.name ?? 'unknown'} is a duplicate, queue exhausted or removal failed`
          )
          break
        }

        currentTrack = validTrack
      }

      // Build track URI and attempt playback
      // Note: Device transfer is NOT needed for normal playback flow.
      // The device is already active from initialization or recovery.
      // Transfer only happens during recovery scenarios (handleNotReady, device validation failures).
      const trackUri = buildTrackUri(currentTrack.tracks.spotify_track_id)

      this.log(
        'INFO',
        `[playNextTrack] Attempting to play track URI: ${trackUri} on device: ${this.deviceId}`
      )

      const success = await this.playTrackWithRetry(
        trackUri,
        this.deviceId,
        PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxRetriesPerTrack
      )

      if (success) {
        // TypeScript guard: currentTrack should still be defined here
        if (!currentTrack) {
          this.log(
            'ERROR',
            '[playNextTrack] Current track became null unexpectedly'
          )
          return
        }

        this.log(
          'INFO',
          `[playNextTrack] Successfully started playback of track: ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id})`
        )

        // Upsert track metadata to database
        // Issue #4 fix: Add error logging to fire-and-forget promise
        // Capture track ID for closure to satisfy TypeScript
        const trackIdForUpsert = currentTrack.tracks.spotify_track_id
        void upsertPlayedTrack(trackIdForUpsert).catch((error) =>
          this.log(
            'ERROR',
            `Failed to upsert played track ${trackIdForUpsert}`,
            error
          )
        )

        this.currentQueueTrack = currentTrack
        // Update queue manager with currently playing track so getNextTrack() excludes it
        queueManager.setCurrentlyPlayingTrack(
          currentTrack.tracks.spotify_track_id
        )
        return
      }

      // Playback failed - remove track and try next
      this.log(
        'WARN',
        `[playNextTrack] Failed to play track ${currentTrack?.tracks.name ?? 'unknown'} (${currentTrack?.tracks.spotify_track_id ?? 'unknown'}) after retries. Queue ID: ${currentTrack?.id ?? 'unknown'}. Trying next track.`
      )

      await withErrorHandling(
        async () => {
          await queueManager.markAsPlayed(currentTrack!.id)
        },
        '[playNextTrack] Remove failed track',
        this.addLog ?? undefined
      )

      // Get next track from queue
      currentTrack = queueManager.getNextTrack() ?? null
    }

    // Issue #3: Loop detection already handled by seenTrackIds.has() check above

    if (attempts >= MAX_ATTEMPTS) {
      this.log(
        'ERROR',
        `[playNextTrack] Maximum attempts (${MAX_ATTEMPTS}) reached. Stopping track playback attempts.`
      )
    } else if (!currentTrack) {
      this.log('WARN', '[playNextTrack] No more tracks available in queue')
    }
  }

  private async handleRestrictionViolatedError(): Promise<void> {
    const currentTrack = this.currentQueueTrack
    if (!currentTrack) {
      this.log(
        'WARN',
        'No current track found, cannot remove problematic track'
      )
      return
    }

    // Phase 2: Check if playbackService has operation in progress
    // This helps avoid state conflicts during active playback operations
    if (playbackService.isOperationInProgress()) {
      this.log(
        'WARN',
        '[syncQueueWithPlayback] Playback operation in progress - state will sync after completion'
      )
      return
    }

    await withErrorHandling(
      async () => {
        await queueManager.markAsPlayed(currentTrack.id)
        const nextTrack = queueManager.getNextTrack()
        this.currentQueueTrack = nextTrack ?? null
      },
      '[handleRestrictionViolatedError] Remove restricted track',
      this.addLog ?? undefined
    )
  }

  /**
   * Returns current internal state diagnostics
   */
  getDiagnostics(): {
    authRetryCount: number
    activeTimeouts: string[]
    internalLogs: LogEntry[]
  } {
    return {
      authRetryCount: recoveryManager.getRetryCount(),
      activeTimeouts: this.timeoutManager.getActiveKeys(),
      internalLogs: [...this.internalLogBuffer].reverse() // Newest first
    }
  }

  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    const TIMEOUT_MS = PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.verificationTimeout // 5000ms

    // Issue #5 fix: Use local timeout variable to prevent race conditions
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => {
        this.log('WARN', `Device verification timed out after ${TIMEOUT_MS}ms`)
        resolve(false) // Timed out
      }, TIMEOUT_MS)
    })

    // Create the verification promise
    const verificationPromise = validateDevice(deviceId)
      .then(
        (result) => result.isValid && !(result.device?.isRestricted ?? false)
      )
      .catch((error) => {
        this.log('ERROR', 'Device verification failed', error)
        return false
      })

    try {
      // Race them
      const result = await Promise.race([verificationPromise, timeoutPromise])
      return result
    } finally {
      // Always cleanup the specific timeout
      clearTimeout(timeoutId!)
    }
  }

  private handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    this.log(
      'WARN',
      `Device ${deviceId} reported as not ready - attempting background recovery`
    )

    const timeoutKey = 'notReady'
    this.timeoutManager.clear(timeoutKey)

    // Background recovery: Try to reactivate the device without destroying the player
    // Add a grace period before triggering recovery to avoid thrashing
    const RECOVERY_GRACE_PERIOD_MS =
      PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.recoveryGracePeriodMs

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          // Guard: Check if player was destroyed while we were waiting
          if (!this.playerRef) {
            this.log(
              'WARN',
              'Player destroyed during recovery grace period - cancelling recovery'
            )
            return
          }

          this.log(
            'INFO',
            'Attempting background recovery: transferring playback to device'
          )

          // Try to transfer playback back to this device
          const transferred = await transferPlaybackToDevice(deviceId)

          // Re-check player existence after async operation
          if (!this.playerRef) {
            this.log(
              'WARN',
              'Player destroyed during recovery transfer - ignoring result'
            )
            return
          }

          if (transferred) {
            this.log(
              'INFO',
              'Background recovery successful - device reactivated'
            )
            onStatusChange('ready', undefined)
          } else {
            this.log(
              'ERROR',
              'Background recovery failed - device could not be reactivated'
            )
            // Only trigger full recovery if background transfer fails
            onStatusChange(
              'recovery_needed',
              'Device recovery failed. Player may need to be recreated.'
            )
          }
        } catch (error) {
          this.log('ERROR', 'Error in not_ready background recovery', error)
        }
      })()
    }, RECOVERY_GRACE_PERIOD_MS)

    this.timeoutManager.set(timeoutKey, timeout)
  }

  private async markFinishedTrackAsPlayed(
    trackId: string,
    trackName: string
  ): Promise<void> {
    const queue = queueManager.getQueue()
    const finishedQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === trackId
    )

    if (finishedQueueItem) {
      await withErrorHandling(
        async () => {
          this.log(
            'INFO',
            `[markFinishedTrackAsPlayed] Marking queue item as played - Queue ID: ${finishedQueueItem.id}, Track: ${finishedQueueItem.tracks.name}`
          )
          await queueManager.markAsPlayed(finishedQueueItem.id)
          this.log(
            'INFO',
            `[markFinishedTrackAsPlayed] Successfully marked queue item as played: ${finishedQueueItem.id}`
          )
        },
        '[markFinishedTrackAsPlayed] Mark track as played',
        this.addLog ?? undefined
      )
    } else {
      this.log(
        'WARN',
        `[markFinishedTrackAsPlayed] No queue item found for finished track: ${trackId} (${trackName}). 
         Queue length: ${queue.length}
         Queue items: ${JSON.stringify(queue.map((i) => `${i.tracks.name} (${i.tracks.spotify_track_id})`))}`
      )
    }
  }

  private async findNextValidTrack(
    finishedTrackId: string
  ): Promise<JukeboxQueueItem | null> {
    // Queue auto-fill is handled by AutoPlayService

    // Get next track - getNextTrack() automatically excludes the currently playing track
    const nextTrack = queueManager.getNextTrack()

    if (!nextTrack) {
      return null
    }

    // Use utility function to ensure track is not a duplicate
    // (shouldn't be needed with excludeTrackId, but keep as safety check)
    const validTrack = await ensureTrackNotDuplicate(
      nextTrack,
      finishedTrackId,
      PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.duplicateCheckRetries,
      this.addLog ?? undefined
    )

    if (!validTrack) {
      // If duplicate removal failed, try alternative track
      const alternativeTrack = queueManager.getTrackAfterNext()
      if (
        alternativeTrack &&
        alternativeTrack.tracks.spotify_track_id !== finishedTrackId
      ) {
        this.log(
          'WARN',
          `[findNextValidTrack] Using alternative track ${alternativeTrack.id} after duplicate detection failure`
        )
        return alternativeTrack
      }

      // No valid track available - pause playback
      if (this.deviceId) {
        await withErrorHandling(
          async () => {
            const SpotifyApiService = (await import('@/services/spotifyApi'))
              .SpotifyApiService
            await SpotifyApiService.getInstance().pausePlayback(this.deviceId!)
          },
          '[findNextValidTrack] Pause playback after duplicate detection',
          this.addLog ?? undefined
        )
      }
      return null
    }

    return validTrack
  }

  /**
   * Handle track finished event.
   * Phase 2: Uses playbackService for promise-chain serialization (no locks needed).
   */
  private async handleTrackFinished(state: PlayerSDKState): Promise<void> {
    await playbackService.executePlayback(
      () => this.handleTrackFinishedImpl(state),
      'handleTrackFinished'
    )
  }

  private async handleTrackFinishedImpl(state: PlayerSDKState): Promise<void> {
    const currentTrack = state.track_window?.current_track

    if (!currentTrack?.id) {
      this.log(
        'WARN',
        '[handleTrackFinished] Track finished but no track ID available'
      )
      return
    }

    const currentSpotifyTrackId = currentTrack.id
    const currentTrackName = currentTrack.name || 'Unknown'

    this.log(
      'INFO',
      `[handleTrackFinished] Track finished - ID: ${currentSpotifyTrackId}, Name: ${currentTrackName}, Position: ${state.position}, Duration: ${state.duration}
       State Debug: Paused=${state.paused}, Position=${state.position}, Duration=${state.duration}`
    )

    // Use shared duplicate detector to prevent duplicate processing
    if (!this.duplicateDetector.shouldProcessTrack(currentSpotifyTrackId)) {
      this.duplicateDetector.setLastKnownPlayingTrack(currentSpotifyTrackId)
      this.log(
        'INFO',
        `[handleTrackFinished] Skipping duplicate processing for track: ${currentSpotifyTrackId}`
      )
      return
    }

    // Mark finished track as played
    await this.markFinishedTrackAsPlayed(
      currentSpotifyTrackId,
      currentTrackName
    )

    // Clear currently playing track before finding next one
    queueManager.setCurrentlyPlayingTrack(null)

    // Find next valid track (handles duplicate detection)
    const nextTrack = await this.findNextValidTrack(currentSpotifyTrackId)

    if (nextTrack) {
      this.currentQueueTrack = nextTrack
      this.log(
        'INFO',
        `[handleTrackFinished] Playing next track: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id}), Queue ID: ${nextTrack.id}`
      )
      await this.playNextTrackImpl(nextTrack)
    } else {
      this.currentQueueTrack = null
      this.log(
        'WARN',
        '[handleTrackFinished] No next track available after track finished. Playback will stop.'
      )
    }
  }

  /**
   * Phase 3: Simplified queue synchronization with playback state.
   * Phase 2: Skips sync if playback operation is in progress to prevent race conditions.
   */
  private syncQueueWithPlayback(state: PlayerSDKState): void {
    // Phase 2: Check if playbackService has operation in progress
    if (playbackService.isOperationInProgress()) {
      this.log(
        'WARN',
        '[syncQueueWithPlayback] Playback operation in progress - state will sync after completion'
      )
      return
    }

    const currentSpotifyTrack = state.track_window?.current_track

    // Update duplicate detector when a new track starts playing
    // This prevents the guard from blocking legitimate track-finished events
    // if the same song plays again (e.g., due to queue sync issues or failed operations)
    if (currentSpotifyTrack) {
      const currentTrackId = currentSpotifyTrack.id
      const lastKnownId = this.duplicateDetector.getLastKnownPlayingTrackId()

      // If track changed, reset processed flag but keep track of new track
      if (lastKnownId !== currentTrackId) {
        // Use the setter to update without processing
        this.duplicateDetector.setLastKnownPlayingTrack(currentTrackId)
      }
    }

    // Early exit: No track or paused
    if (!currentSpotifyTrack || state.paused) {
      queueManager.setCurrentlyPlayingTrack(null)
      return
    }

    // Track is playing - update queue manager
    queueManager.setCurrentlyPlayingTrack(currentSpotifyTrack.id)

    // Sync internal queue track reference
    const queue = queueManager.getQueue()
    const matchingQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === currentSpotifyTrack.id
    )

    if (matchingQueueItem) {
      // Case 1: Current track found in queue - sync to it
      if (this.currentQueueTrack?.id !== matchingQueueItem.id) {
        this.log(
          'INFO',
          `Syncing queue: Current track changed from ${this.currentQueueTrack?.id ?? 'none'} to ${matchingQueueItem.id}`
        )
        this.currentQueueTrack = matchingQueueItem
      }
    } else {
      // Case 2: Current track NOT in queue

      // Issue #12: Enforce queue order
      // If the current track is not in the queue, and we have tracks in the queue,
      // we should skip the current track and play the next one from the queue.
      if (queue.length > 0 && !state.paused) {
        const expectedTrack = this.currentQueueTrack || queue[0]

        this.log(
          'WARN',
          `[syncQueueWithPlayback] Enforcing queue order: Track ${currentSpotifyTrack.name} (${currentSpotifyTrack.id}) is playing but not in queue. Jukebox expected: ${expectedTrack.tracks.name}`
        )

        // Force skip to the correct track
        void this.playNextTrack(expectedTrack)
        return
      }

      // If queue is empty, just clear our tracking
      if (this.currentQueueTrack) {
        // Playing track is external - clear queue reference
        this.log(
          'WARN',
          `Playing track ${currentSpotifyTrack.id} not found in queue - clearing queue reference`
        )
        this.currentQueueTrack = null
      }
    }
  }

  private transformStateForUI(
    state: PlayerSDKState
  ): SpotifyPlaybackState | null {
    const currentTrack = state.track_window?.current_track

    if (!currentTrack) {
      // Return null instead of invalid empty object
      return null
    }

    return {
      item: {
        id: currentTrack.id,
        name: currentTrack.name,
        uri: currentTrack.uri,
        duration_ms: currentTrack.duration_ms,
        artists: currentTrack.artists.map((artist) => ({
          name: artist.name
        })),
        album: {
          name: currentTrack.album.name,
          images: currentTrack.album.images
        }
      },
      is_playing: !state.paused,
      progress_ms: state.position,
      timestamp: Date.now(),
      context: { uri: '' },
      device: {
        id: this.deviceId ?? '',
        is_active: true,
        is_private_session: false,
        is_restricted: false,
        name: 'Jukebox Player',
        type: 'Computer',
        volume_percent: 50
      }
    }
  }

  private isTrackFinished(state: PlayerSDKState): boolean {
    if (!this.lastKnownState) {
      return false
    }

    const lastTrack = this.lastKnownState.track_window?.current_track
    const currentTrack = state.track_window?.current_track

    // Both tracks must exist to compare
    if (!lastTrack || !currentTrack) {
      return false
    }

    // Tracks must be the same
    if (lastTrack.uri !== currentTrack.uri) {
      return false
    }

    // Condition 1: Clean track finish (paused at position 0)
    const trackJustFinished =
      !this.lastKnownState.paused && state.paused && state.position === 0

    if (trackJustFinished) {
      this.log(
        'INFO',
        '[isTrackFinished] Detected clean track finish (paused at 0)'
      )
      return true
    }

    // Condition 2: Wrap-around detection (for when Repeat Mode is mistakenly active)
    // If the track seamlessly repeats, the position will jump from near-end to near-start
    // without ever pausing.
    const wasNearEnd =
      this.lastKnownState.duration > 0 &&
      this.lastKnownState.position > this.lastKnownState.duration * 0.9 // > 90% complete

    const isNowNearStart = state.position < 3000 // < 3 seconds into the track

    // Ensure we are actually playing and it's likely a wrap-around
    if (wasNearEnd && isNowNearStart && !state.paused) {
      this.log(
        'WARN',
        `[isTrackFinished] Detected track wrap-around (seamless repeat). Last pos: ${this.lastKnownState.position}, New pos: ${state.position}. Forcing track finish.`
      )
      return true
    }

    const isNearEnd =
      state.duration > 0 &&
      state.duration - state.position <
      PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS

    const positionUnchanged = state.position === this.lastKnownState.position

    const wasPlayingButNowPaused = !this.lastKnownState.paused && state.paused

    // Issue #9: Use config for stall detection time threshold
    const timeSinceLastUpdate = Date.now() - this.lastStateUpdateTime
    const hasStalled =
      positionUnchanged &&
      wasPlayingButNowPaused &&
      timeSinceLastUpdate >
      PLAYER_LIFECYCLE_CONFIG.STATE_MONITORING.stallDetectionMs

    return isNearEnd && hasStalled
  }

  private async handlePlayerStateChanged(
    state: PlayerSDKState,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<void> {
    try {
      // Issue #13: SDK state updates indicate this device is active.
      // Cross-device enforcement is handled by AutoPlayService and DeviceValidation.

      if (this.isTrackFinished(state)) {
        await this.handleTrackFinished(state)
      }

      this.syncQueueWithPlayback(state)
      this.lastKnownState = state

      const transformedState = this.transformStateForUI(state)
      if (transformedState) {
        onPlaybackStateChange(transformedState)
      }
    } catch (error) {
      this.log('ERROR', 'Error in player state changed handler', error)
    }
  }

  private async processStateChange(
    state: PlayerSDKState,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<void> {
    // Phase 3: Track time for stall detection
    this.lastStateUpdateTime = Date.now()

    // Serialization: If a state change is already being processed, queue this one
    if (this.stateChangeInProgress) {
      // Add to queue, but limit size to prevent memory issues
      if (this.pendingStates.length < this.MAX_PENDING_STATES) {
        this.pendingStates.push(state)
      } else {
        this.log(
          'WARN',
          `State change queue full (${this.MAX_PENDING_STATES}), dropping oldest state`
        )
        // Drop oldest state and add new one
        this.pendingStates.shift()
        this.pendingStates.push(state)
      }
      return
    }

    this.stateChangeInProgress = true

    try {
      // Process current state
      await this.handlePlayerStateChanged(state, onPlaybackStateChange)

      // Process all pending states that arrived while we were working
      while (this.pendingStates.length > 0) {
        const nextState = this.pendingStates.shift()!
        this.lastStateUpdateTime = Date.now() // Update time for each state
        await this.handlePlayerStateChanged(nextState, onPlaybackStateChange)
      }
    } finally {
      this.stateChangeInProgress = false
    }
  }

  private async handleAuthenticationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<void> {
    this.log('ERROR', `Failed to authenticate: ${message}`)

    // Phase 3: Check if recovery is possible
    if (!recoveryManager.canAttemptRecovery()) {
      this.log(
        'ERROR',
        `Authentication retry limit reached (${recoveryManager.getRetryCount()} attempts)`
      )
      onStatusChange(
        'error',
        `Authentication failed after ${recoveryManager.getRetryCount()} attempts. Click to reload player.`
      )
      this.isRecoveryNeeded = true
      return
    }

    // Phase 3: Record recovery attempt
    recoveryManager.recordAttempt()

    try {
      tokenManager.clearCache()

      // Attempt to get a fresh token (this will use the recovery logic in API endpoints)
      const token = await tokenManager.getToken()

      if (!token) {
        throw new Error('Failed to obtain token after refresh')
      }

      onStatusChange(
        'initializing',
        `Refreshing authentication (attempt ${recoveryManager.getRetryCount()}/${PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS})`
      )

      this.destroyPlayer({ resetRecovery: false })
      await this.createPlayer(
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )

      // Phase 3: Reset recovery state on success
      recoveryManager.recordSuccess()
      this.isRecoveryNeeded = false
    } catch (error) {
      this.log('ERROR', 'Failed to recover from authentication error', error)

      // Check if error indicates user action is required
      // Check both error message and error code if available
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const errorCode =
        error instanceof Error && 'code' in error
          ? (error as Error & { code?: string }).code
          : undefined

      const needsUserAction =
        errorCode === 'INVALID_REFRESH_TOKEN' ||
        errorCode === 'INVALID_CLIENT_CREDENTIALS' ||
        errorCode === 'NO_REFRESH_TOKEN' ||
        errorCode === 'NOT_AUTHENTICATED' ||
        errorMessage.includes('INVALID_REFRESH_TOKEN') ||
        errorMessage.includes('INVALID_CLIENT_CREDENTIALS') ||
        errorMessage.includes('NO_REFRESH_TOKEN') ||
        errorMessage.includes('NOT_AUTHENTICATED')

      // Phase 3: Check if recovery should stop
      if (needsUserAction || !recoveryManager.canAttemptRecovery()) {
        // Last resort: require manual recovery
        onStatusChange('error', 'Player recovery failed. Click to reload.')
        this.isRecoveryNeeded = true
      } else {
        // Schedule retry for recoverable errors
        onStatusChange(
          'error',
          `Authentication error (attempt ${recoveryManager.getRetryCount()}/${PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS}). Retrying...`
        )
        const timeout = setTimeout(() => {
          void this.handleAuthenticationError(
            message,
            onStatusChange,
            onDeviceIdChange,
            onPlaybackStateChange
          )
        }, 5000)
        this.timeoutManager.set('authRetry', timeout)
      }
    }
  }

  private handleAccountError(message: string): void {
    this.log('ERROR', `Account error: ${message}`)

    const isPremiumError =
      message.toLowerCase().includes('premium') ||
      message.toLowerCase().includes('subscription') ||
      message.toLowerCase().includes('not available') ||
      message.toLowerCase().includes('upgrade')

    if (isPremiumError) {
      if (this.navigationCallback) {
        this.navigationCallback('/premium-required')
      } else {
        // Issue #7 fix: Don't manipulate DOM directly - throw error instead
        this.log('ERROR', 'Navigation callback not set for premium redirect')
        throw new Error(
          'Premium account required but navigation callback not configured'
        )
      }
    }
  }

  /**
   * Phase 2: Force recovery method for unrecoverable states.
   * Provides escape hatch when automatic recovery fails.
   */
  async forceRecovery(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<void> {
    this.log('INFO', 'Force recovery initiated by user')
    // Phase 3: Reset recovery state on device ready
    recoveryManager.recordSuccess()
    this.isRecoveryNeeded = false

    try {
      await this.reloadSDK()
      await this.createPlayer(
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )
    } catch (error) {
      this.log('ERROR', 'Force recovery failed', error)
      onStatusChange('error', 'Recovery failed. Please refresh the page.')
    }
  }

  private clearAllTimeouts(): void {
    this.timeoutManager.clearAll()
  }

  /**
   * Phase 2: Handle device ready event
   * Extracted from createPlayer to reduce complexity
   */
  private async handleDeviceReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): Promise<void> {
    // Guard: Check player exists before starting
    if (!this.playerRef) {
      this.log('WARN', 'Player destroyed before ready handler - aborting')
      return
    }

    // Consolidate verification and transfer logic to prevent race conditions
    this.timeoutManager.clear('notReady')
    onStatusChange('verifying')

    // Step 1: Verify the device exists and is accessible
    const deviceExisted = await this.verifyDeviceWithTimeout(deviceId)

    // Guard: Re-check after async operation
    if (!this.playerRef) {
      this.log('WARN', 'Player destroyed during device verification')
      return
    }

    if (!deviceExisted) {
      this.log(
        'WARN',
        'Device verification failed/timed-out. Attempting direct playback transfer as recovery.'
      )
    }

    // Step 2: Set local ID
    this.deviceId = deviceId
    onDeviceIdChange(deviceId)

    // Step 3: Transfer playback (this is the real "activation")
    const transferSuccess = await transferPlaybackToDevice(deviceId)

    // Guard: Re-check after async operation
    if (!this.playerRef) {
      this.log('WARN', 'Player destroyed during playback transfer')
      return
    }

    if (!transferSuccess) {
      this.log('ERROR', 'Failed to transfer playback to new device')
      onStatusChange('error', 'Failed to transfer playback to new device')
      return
    }

    // Success
    onStatusChange('ready')
    recoveryManager.recordSuccess()

    // Resolve promise if resolver exists
    if (this.deviceReadyResolver) {
      this.deviceReadyResolver(deviceId)
      this.deviceReadyResolver = null
      this.deviceErrorResolver = null
    }

    // Phase 4: Enforce Repeat Mode 'off' after device is ready
    // This prevents tracks from seamlessly looping, which would bypass our track finish detection.
    try {
      this.log('INFO', 'Enforcing Repeat Mode: off')
      // Import dynamically to avoid circular dependencies if any, or just use existing import if clean
      const SpotifyApiService = (await import('@/services/spotifyApi'))
        .SpotifyApiService
      await SpotifyApiService.getInstance().setRepeatMode('off', deviceId)
    } catch (error) {
      // Log warning but don't fail initialization
      this.log(
        'WARN',
        'Failed to enforce repeat mode off during initialization',
        error
      )
    }
  }

  /**
   * Phase 2: Handle initialization error
   * Extracted from createPlayer to reduce complexity
   */
  private handleInitializationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    // Get additional context for better diagnostics
    const sdkAvailable = typeof window.Spotify !== 'undefined'
    const tokenCheck = tokenManager.getToken().catch(() => null)

    void tokenCheck.then((token) => {
      const errorDetails = {
        sdkMessage: message,
        sdkAvailable,
        hasToken: !!token,
        tokenLength: token?.length ?? 0,
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        timestamp: new Date().toISOString()
      }

      this.log(
        'ERROR',
        `Failed to initialize player: ${message}. Context: SDK=${sdkAvailable}, Token=${!!token}, TokenLength=${token?.length ?? 0}`,
        new Error(JSON.stringify(errorDetails, null, 2))
      )
    })

    onStatusChange(
      'error',
      `Initialization error: ${message}. Check console for details.`
    )

    // Resolve error promise if resolver exists
    if (this.deviceErrorResolver) {
      this.deviceErrorResolver(new Error(message))
      this.deviceErrorResolver = null
      this.deviceReadyResolver = null
    }
  }

  /**
   * Phase 2: Handle playback error
   * Extracted from createPlayer to reduce complexity
   */
  private handlePlaybackError(message: string): void {
    this.log('ERROR', `Playback error: ${message}`)

    if (message.includes('Restriction violated')) {
      this.log(
        'WARN',
        'Restriction violated error detected - removing problematic track and playing next'
      )
      void this.handleRestrictionViolatedError().catch((error) =>
        this.log('ERROR', 'Error handling restriction violated error', error)
      )
    } else {
      this.log(
        'WARN',
        'Playback error occurred, but error handling is managed by health monitor'
      )
    }
  }

  /**
   * Phase 2: Handle player state change event
   * Extracted from createPlayer to reduce complexity
   */
  private handlePlayerStateChangeEvent(
    state: unknown,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): void {
    if (!state) {
      // Lightweight recovery: Don't immediately recreate player
      this.consecutiveNullStates++

      const NULL_STATE_THRESHOLD =
        PLAYER_LIFECYCLE_CONFIG.STATE_MONITORING.nullStateThreshold

      if (this.consecutiveNullStates >= NULL_STATE_THRESHOLD) {
        this.log(
          'ERROR',
          `Received ${this.consecutiveNullStates} consecutive null states. Device is persistently inactive. Triggering recovery.`
        )
        this.consecutiveNullStates = 0

        void this.handleAuthenticationError(
          'Device persistently inactive',
          onStatusChange,
          onDeviceIdChange,
          onPlaybackStateChange
        ).catch((error) =>
          this.log('ERROR', 'Error in authentication error handler', error)
        )
      } else {
        this.log(
          'WARN',
          `Received null state in player_state_changed event (${this.consecutiveNullStates}/${NULL_STATE_THRESHOLD}). Device may be temporarily inactive.`
        )
      }
      return
    }

    // Reset null state counter on successful state
    this.consecutiveNullStates = 0

    // Runtime validation
    if (!isPlayerSDKState(state)) {
      this.log(
        'ERROR',
        'Invalid state shape received in player_state_changed',
        new Error('Invalid state structure')
      )
      return
    }

    void this.processStateChange(state, onPlaybackStateChange)
  }

  async createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<string> {
    // Check preconditions
    if (this.playerRef) {
      throw new Error('Player already exists')
    }

    if (typeof window.Spotify === 'undefined') {
      this.log('ERROR', 'Spotify SDK not loaded')
      onStatusChange('error', 'Spotify SDK not loaded')
      throw new Error('Spotify SDK not loaded')
    }

    try {
      // Set up device management logger
      setDeviceManagementLogger(
        this.addLog ??
        ((level, message, _context, error) => {
          if (level === 'WARN') {
            console.warn(`[DeviceManagement] ${message}`, error)
          } else if (level === 'ERROR') {
            console.error(`[DeviceManagement] ${message}`, error)
          }
        })
      )

      // Clear any existing cleanup timeout
      this.timeoutManager.clear('cleanup')

      onStatusChange('initializing')

      onStatusChange('initializing')

      // Verify token availability implicitly via promise chain later or rely on error handling
      // Duplicate token check removed for efficiency

      const player = new window.Spotify.Player({
        name: 'Jukebox Player',
        getOAuthToken: (cb) => {
          tokenManager
            .getToken()
            .then((token) => {
              if (!token) {
                this.log(
                  'ERROR',
                  'Token manager returned null token in getOAuthToken callback'
                )
                throw new Error('Token is null')
              }
              cb(token)
            })
            .catch((error) => {
              this.log(
                'ERROR',
                'Error getting token from token manager in getOAuthToken callback',
                error
              )
              throw error
            })
        },
        volume: 0.5
      })

      // Phase 1 & 2: Set up event listeners with consolidated promise resolution
      // Note: Spotify SDK's player.disconnect() handles listener cleanup automatically
      player.addListener('ready', ({ device_id }) => {
        void (async () => {
          try {
            await this.handleDeviceReady(
              device_id,
              onStatusChange,
              onDeviceIdChange
            )
          } catch (error) {
            this.log('ERROR', 'Ready handler failed', error)
            if (this.deviceErrorResolver) {
              this.deviceErrorResolver(
                error instanceof Error ? error : new Error(String(error))
              )
              this.deviceErrorResolver = null
              this.deviceReadyResolver = null
            }
            onStatusChange('error', 'Device initialization failed')
          }
        })()
      })

      player.addListener('not_ready', (event) => {
        void this.handleNotReady(event.device_id, onStatusChange)
      })

      player.addListener('initialization_error', ({ message }) => {
        this.handleInitializationError(message, onStatusChange)
      })

      player.addListener('authentication_error', ({ message }) => {
        void this.handleAuthenticationError(
          message,
          onStatusChange,
          onDeviceIdChange,
          onPlaybackStateChange
        )
      })

      player.addListener('account_error', ({ message }) => {
        this.handleAccountError(message)
        onStatusChange('error', `Account error: ${message}`)
      })

      player.addListener('playback_error', ({ message }) => {
        this.handlePlaybackError(message)
      })

      player.addListener('player_state_changed', (state) => {
        this.handlePlayerStateChangeEvent(
          state,
          onPlaybackStateChange,
          onStatusChange,
          onDeviceIdChange
        )
      })

      // Connect to Spotify
      const connected = await player.connect()
      if (!connected) {
        throw new Error('Failed to connect to Spotify')
      }

      // Store player instance
      this.playerRef = player
      window.spotifyPlayerInstance = player

      // Return promise using resolvers set in event listeners
      return new Promise<string>((resolve, reject) => {
        // Reject previous promise if it exists
        if (this.deviceReadyResolver) {
          this.deviceErrorResolver?.(new Error('Player creation superseded'))
        }

        // Wrapper to clear initialization timeout on success
        const resolveWrapper = (deviceId: string) => {
          this.timeoutManager.clear('initialization')
          resolve(deviceId)
        }

        // Wrapper to clear initialization timeout on error
        const rejectWrapper = (error: Error) => {
          this.timeoutManager.clear('initialization')
          reject(error)
        }

        this.deviceReadyResolver = resolveWrapper
        this.deviceErrorResolver = rejectWrapper

        // Set strict initialization timeout
        const initTimeout = setTimeout(async () => {
          if (this.deviceErrorResolver === rejectWrapper) {
            const token = await tokenManager.getToken().catch(() => null)
            this.log(
              'ERROR',
              `Player initialization timed out after ${PLAYER_LIFECYCLE_CONFIG.INITIALIZATION_TIMEOUT_MS}ms. This may due to: 1) SDK script loading failure, 2) Token issue (token length: ${token?.length ?? 0
              }), 3) Network blocking.`
            )
            rejectWrapper(new Error('Player initialization timed out'))
            this.deviceReadyResolver = null
            this.deviceErrorResolver = null
          }
        }, PLAYER_LIFECYCLE_CONFIG.INITIALIZATION_TIMEOUT_MS)
        this.timeoutManager.set('initialization', initTimeout)

        // Store cleanup function to prevent memory leaks
        this.pendingPromiseCleanup = () => {
          this.deviceReadyResolver = null
          this.deviceErrorResolver = null
          this.timeoutManager.clear('initialization')
        }
      })
    } catch (error) {
      this.clearAllTimeouts()
      this.log('ERROR', 'Error creating player', error)
      throw error
    }
  }

  destroyPlayer(options: { resetRecovery: boolean } = { resetRecovery: true }): void {
    this.clearAllTimeouts()

    // Clear all timeouts from TimeoutManager to prevent memory leaks
    this.timeoutManager.clearAll()

    // Clean up pending promise handlers
    if (this.pendingPromiseCleanup) {
      this.pendingPromiseCleanup()
      this.pendingPromiseCleanup = null
    }

    // Phase 2: Clean up device ready resolvers
    if (this.deviceErrorResolver) {
      this.deviceErrorResolver(new Error('Player destroyed'))
      this.deviceErrorResolver = null
      this.deviceReadyResolver = null
    }

    // Phase 1: Disconnect player and cleanup listeners
    // Note: Spotify SDK's disconnect() automatically removes all event listeners
    if (this.playerRef) {
      this.playerRef.disconnect()
      this.playerRef = null
    }

    // Phase 1: Delegate cleanup to spotifyPlayer service
    // This ensures proper event listener and timeout cleanup
    spotifyPlayer.destroy()

    // Reset state
    this.duplicateDetector.reset()
    // Phase 3: Reset recovery state on destroy
    if (options.resetRecovery) {
      recoveryManager.reset()
    }
    this.consecutiveNullStates = 0
  }

  getPlayer(): Spotify.Player | null {
    return this.playerRef
  }

  /**
   * Public helper to play the next track from the current jukebox queue.
   * This is used by user-initiated actions (e.g. admin skip) so that
   * all track-to-track transitions still flow through the same internal
   * playNextTrack logic and device management.
   */
  async playNextFromQueue(): Promise<void> {
    this.log(
      'INFO',
      '[playNextFromQueue] Requested to play next track from queue'
    )
    const nextTrack = queueManager.getNextTrack()
    if (!nextTrack) {
      this.log(
        'WARN',
        '[playNextFromQueue] Skip requested but no next track is available in queue'
      )
      return
    }

    await this.playNextTrack(nextTrack)
  }

  async reloadSDK(): Promise<void> {
    // Phase 1: Delegate SDK reloading to spotifyPlayer service
    await spotifyPlayer.reloadSDK()
    // Clear local player reference
    this.playerRef = null
    if (typeof window !== 'undefined') {
      window.spotifyPlayerInstance = null
    }
  }

  /**
   * Set the manual pause state.
   * Call this when the user explicitly pauses playback via the Jukebox UI.
   */
  public setManualPause(isManualPause: boolean): void {
    this.isManualPause = isManualPause
    this.log('INFO', `Manual pause state set to: ${isManualPause}`)
  }

  /**
   * Get the current manual pause state.
   */
  public getIsManualPause(): boolean {
    return this.isManualPause
  }

  /**
   * Resume playback and clear manual pause state.
   */
  public async resumePlayback(): Promise<void> {
    if (!this.deviceId) {
      this.log('WARN', '[resumePlayback] No device ID available')
      return
    }

    this.log('INFO', '[resumePlayback] Resuming playback')
    try {
      await spotifyPlayer.resume()
      this.isManualPause = false
    } catch (error) {
      this.log('ERROR', '[resumePlayback] Failed to resume playback', error)
      throw error
    }
  }
}

// Export singleton instance
export const playerLifecycleService = new PlayerLifecycleService()

// Phase 4: Export class for testing
// This allows tests to create isolated instances with mocked dependencies
export { PlayerLifecycleService }
