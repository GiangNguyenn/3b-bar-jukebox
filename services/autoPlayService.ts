import { JukeboxQueueItem } from '@/shared/types/queue'
import { sendApiRequest } from '@/shared/api'
import { QueueManager } from './queueManager'
import { createModuleLogger } from '@/shared/utils/logger'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import {
  FALLBACK_GENRES,
  DEFAULT_YEAR_RANGE,
  MIN_TRACK_POPULARITY,
  DEFAULT_MAX_SONG_LENGTH_MINUTES,
  DEFAULT_MAX_OFFSET
} from '@/shared/constants/trackSuggestion'
import { PLAYER_LIFECYCLE_CONFIG } from './playerLifecycleConfig'

const logger = createModuleLogger('AutoPlayService')

interface AutoPlayServiceConfig {
  checkInterval?: number // How often to check playback state (default: 5 seconds)
  deviceId?: string | null
  onTrackFinished?: (trackId: string) => void
  onNextTrackStarted?: (track: JukeboxQueueItem) => void
  onQueueEmpty?: () => void
  onQueueLow?: () => void // New callback for when queue is low
  username?: string | null // Username for auto-fill operations
  autoFillTargetSize?: number // Target number of tracks for auto-fill (default: 10)
  autoFillMaxAttempts?: number // Maximum attempts for auto-fill (default: 20)
}

class AutoPlayService {
  private static instanceCount = 0
  private instanceId: number
  private isRunning = false
  private checkInterval: number
  private deviceId: string | null = null
  private lastPlaybackState: SpotifyPlaybackState | null = null
  private lastTrackId: string | null = null
  private intervalRef: NodeJS.Timeout | null = null
  private queueManager: QueueManager
  private onTrackFinished?: (trackId: string) => void
  private onNextTrackStarted?: (track: JukeboxQueueItem) => void
  private onQueueEmpty?: () => void
  private onQueueLow?: () => void
  private username: string | null = null
  private isAutoFilling = false // Prevent multiple simultaneous auto-fill operations
  private lastProcessedTrackId: string | null = null // Prevent processing the same track multiple times
  private autoFillTargetSize: number
  private autoFillMaxAttempts: number
  private trackSuggestionsState: any = null // User's track suggestions configuration
  private isAutoPlayDisabled: boolean = false // Flag to temporarily disable auto-play during manual operations
  private isInitialized: boolean = false // Flag to track if the service is properly initialized
  // Predictive track start state
  private nextTrackPrepared: boolean = false // Flag indicating next track is ready
  private preparedTrackId: string | null = null // ID of the prepared track
  private isPreparingNextTrack: boolean = false // Prevent duplicate preparation
  private nextTrackStarted: boolean = false // Flag indicating next track was started predictively
  // Spotify queue integration state
  private spotifyQueuedTrackId: string | null = null // Track currently in Spotify queue
  private isUpdatingSpotifyQueue: boolean = false // Prevent concurrent queue updates
  private isStartingNextTrack: boolean = false // Prevent concurrent track transitions

  constructor(config: AutoPlayServiceConfig = {}) {
    AutoPlayService.instanceCount++
    this.instanceId = AutoPlayService.instanceCount
    if (AutoPlayService.instanceCount > 1) {
      logger(
        'ERROR',
        `MULTIPLE INSTANCES DETECTED! Count: ${AutoPlayService.instanceCount}`
      )
    }
    this.checkInterval = config.checkInterval || 500 // Reduced to 500ms for predictive track start
    this.deviceId = config.deviceId || null
    this.onTrackFinished = config.onTrackFinished
    this.onNextTrackStarted = config.onNextTrackStarted
    this.onQueueEmpty = config.onQueueEmpty
    this.onQueueLow = config.onQueueLow
    this.username = config.username || null
    this.autoFillTargetSize = config.autoFillTargetSize || 10 // Default fallback, will be overridden by track suggestions state
    this.autoFillMaxAttempts = config.autoFillMaxAttempts || 20
    this.queueManager = QueueManager.getInstance()
  }

  public start(): void {
    if (this.isRunning) {
      logger('WARN', 'Auto-play service is already running')
      return
    }

    this.isRunning = true

    // Start with the configured check interval
    this.startPolling()
  }

  private startPolling(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef)
    }

    this.intervalRef = setInterval(() => {
      void this.checkPlaybackState()
    }, this.checkInterval)
  }

  private adjustPollingInterval(currentState: SpotifyPlaybackState): void {
    if (!currentState.item || !currentState.is_playing) {
      return
    }

    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const timeRemaining = duration - progress

    // Dynamic polling: increase frequency when approaching track end
    let newInterval = 500 // Default 500ms

    if (timeRemaining <= 10000) {
      // Last 10 seconds: poll every 250ms for better precision
      newInterval = 250
    } else if (timeRemaining <= 30000) {
      // Last 30 seconds: poll every 500ms
      newInterval = 500
    } else {
      // Rest of the track: poll every 1000ms to reduce API calls
      newInterval = 1000
    }

    // Update interval if it changed
    if (newInterval !== this.checkInterval) {
      this.checkInterval = newInterval
      this.startPolling()
    }
  }

  public stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false

    if (this.intervalRef) {
      clearInterval(this.intervalRef)
      this.intervalRef = null
    }

    // Clear Spotify queue state when stopping
    this.spotifyQueuedTrackId = null
    this.lastProcessedTrackId = null
    this.resetPredictiveState('Service stopped')
  }

  public setDeviceId(deviceId: string | null): void {
    this.deviceId = deviceId
  }

  public setUsername(username: string | null): void {
    this.username = username
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    const previousQueueLength = this.queueManager.getQueue().length
    this.queueManager.updateQueue(queue)
    const currentQueueLength = queue.length

    // Validate prepared track after queue update
    this.validatePreparedTrack()

    // Trigger auto-fill check if queue is below target size
    // Only check if service is running, initialized, and we have username
    if (
      this.isRunning &&
      this.isInitialized &&
      this.username &&
      currentQueueLength < this.autoFillTargetSize &&
      !this.isAutoFilling
    ) {
      logger(
        'INFO',
        `Queue updated: ${currentQueueLength}/${this.autoFillTargetSize} tracks, triggering auto-fill check`
      )
      // Use setTimeout to avoid blocking queue update
      setTimeout(() => {
        void this.checkAndAutoFillQueue()
      }, 500)
    }
  }

  public setTrackSuggestionsState(state: any): void {
    logger(
      'INFO',
      `[setTrackSuggestionsState] Setting track suggestions state: ${JSON.stringify(state)}`
    )
    logger(
      'INFO',
      `[setTrackSuggestionsState] State type: ${typeof state}, is null: ${state === null}, is undefined: ${state === undefined}`
    )

    this.trackSuggestionsState = state

    // Update autoFillTargetSize from track suggestions state if available
    if (state?.autoFillTargetSize !== undefined) {
      this.autoFillTargetSize = state.autoFillTargetSize
      logger(
        'INFO',
        `[setTrackSuggestionsState] Updated autoFillTargetSize to: ${this.autoFillTargetSize}`
      )
    }

    // If this is the first time setting the state and we have a queue, trigger an auto-fill check
    if (state && this.isRunning && this.username) {
      const queue = this.queueManager.getQueue()
      if (queue.length < this.autoFillTargetSize) {
        logger(
          'INFO',
          `Track suggestions state initialized, checking if auto-fill is needed`
        )
        // Use setTimeout to avoid blocking the current operation
        setTimeout(() => {
          void this.checkAndAutoFillQueue()
        }, 1000)
      }
    }
  }

  public disableAutoPlay(): void {
    this.isAutoPlayDisabled = true
  }

  public enableAutoPlay(): void {
    this.isAutoPlayDisabled = false
  }

  public markAsInitialized(): void {
    this.isInitialized = true
  }

  private async checkPlaybackState(): Promise<void> {
    try {
      const currentState = await this.getCurrentPlaybackState()

      // Periodically check if queue needs auto-fill (even when no playback state)
      // This ensures auto-fill happens even if playback is stopped or no device is active
      if (this.isInitialized && this.username) {
        void this.checkAndAutoFillQueue()
      }

      if (!currentState) {
        logger(
          'INFO',
          '[checkPlaybackState] No current playback state available'
        )
        return
      }

      const currentTrackId = currentState.item?.id
      const isPlaying = currentState.is_playing
      const progress = currentState.progress_ms || 0
      const duration = currentState.item?.duration_ms || 0

      // Edge case: Reset predictive state if playback is paused
      if (!isPlaying && (this.nextTrackPrepared || this.nextTrackStarted)) {
        logger(
          'INFO',
          '[checkPlaybackState] Playback paused, resetting predictive state'
        )
        this.resetPredictiveState('Playback paused')
      }

      // Reset lastProcessedTrackId if we're playing a different track
      // Edge case: Manual skip detected
      if (currentTrackId && currentTrackId !== this.lastTrackId) {
        this.lastProcessedTrackId = null

        // Check if the new track is the locked track
        if (this.spotifyQueuedTrackId === currentTrackId) {
          // The locked track is now playing - this is expected!

          // Remove the FINISHED track (the previous track) from the queue
          if (this.lastTrackId && this.lastTrackId !== currentTrackId) {
            const queue = this.queueManager.getQueue()
            const finishedTrackItem = queue.find(
              (item) => item.tracks.spotify_track_id === this.lastTrackId
            )

            if (finishedTrackItem) {
              try {
                await this.queueManager.markAsPlayed(finishedTrackItem.id)
                await this.refreshQueueFromAPI()

                // Mark the finished track as processed to prevent handleTrackFinished from re-processing it
                this.lastProcessedTrackId = this.lastTrackId
              } catch (error) {
                logger(
                  'ERROR',
                  'Failed to remove finished track after locked track transition',
                  undefined,
                  error as Error
                )
              }
            }
          }

          // Clear the lock and reset state so we can prepare the next track
          this.spotifyQueuedTrackId = null
          this.resetPredictiveState('Locked track now playing')
        } else if (
          this.spotifyQueuedTrackId &&
          this.spotifyQueuedTrackId !== currentTrackId
        ) {
          // Manual skip to a different track - clear the lock
          logger(
            'INFO',
            `[checkPlaybackState] Manual skip from locked track ${this.spotifyQueuedTrackId} to ${currentTrackId}`
          )
          this.spotifyQueuedTrackId = null
          this.resetPredictiveState('Manual skip to different track')
        } else {
          // Track changed but no lock was set
          if (this.lastTrackId) {
            logger(
              'INFO',
              `[checkPlaybackState] Track changed from ${this.lastTrackId} to ${currentTrackId}`
            )
          }
          this.resetPredictiveState('Track changed (no lock)')
        }
      }

      // Predictive track start - Phase 1: Prepare next track
      if (this.shouldPrepareNextTrack(currentState) && currentTrackId) {
        await this.prepareNextTrack(currentTrackId)
      }

      // Safety net: Last resort preparation at 10s before end if still not locked
      if (
        currentTrackId &&
        !this.spotifyQueuedTrackId &&
        !this.isPreparingNextTrack
      ) {
        const timeRemaining = duration - progress
        if (
          timeRemaining > 0 &&
          timeRemaining <= 10000 &&
          timeRemaining > 5000
        ) {
          logger(
            'WARN',
            `Safety net triggered: ${timeRemaining}ms remaining and track not locked yet`
          )
          await this.prepareNextTrack(currentTrackId)
        }
      }

      // Predictive track start - Phase 2: Start next track
      if (this.shouldStartNextTrack(currentState)) {
        await this.startNextTrackPredictively()
      }

      // Fallback: Check if track has finished (for edge cases)
      const trackFinished = this.hasTrackFinished(currentState)
      if (trackFinished) {
        // Use the FINISHED track ID from lastPlaybackState, not currentTrackId
        const finishedTrackId = this.lastPlaybackState?.item?.id
        try {
          await this.handleTrackFinished(finishedTrackId)
        } catch (error) {
          logger(
            'ERROR',
            'Exception in handleTrackFinished',
            undefined,
            error as Error
          )
          logger(
            'ERROR',
            `[checkPlaybackState] Error details: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      }

      // Adjust polling interval based on track progress
      this.adjustPollingInterval(currentState)

      // Update last known state
      this.lastPlaybackState = currentState
      this.lastTrackId = currentTrackId || null
    } catch (error) {
      logger(
        'ERROR',
        'Error checking playback state',
        undefined,
        error as Error
      )
    }
  }

  private shouldPrepareNextTrack(currentState: SpotifyPlaybackState): boolean {
    // Edge case: Don't prepare if playback is paused
    if (!currentState.item || !currentState.is_playing) {
      return false
    }

    // Only skip if we have a LOCKED track or are currently preparing
    // This allows retries if preparation didn't result in a lock
    if (this.spotifyQueuedTrackId || this.isPreparingNextTrack) {
      return false
    }

    // Edge case: Don't prepare if auto-play is disabled
    if (this.isAutoPlayDisabled) {
      return false
    }

    // Edge case: Check if there's a next track available
    const nextTrack = this.queueManager.getNextTrack()
    if (!nextTrack) {
      return false
    }

    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const timeRemaining = duration - progress

    // Check if we're within the prepare threshold
    return (
      timeRemaining > 0 &&
      timeRemaining <= PLAYER_LIFECYCLE_CONFIG.TRACK_PREPARE_THRESHOLD_MS
    )
  }

  private async prepareNextTrack(
    currentTrackId: string
  ): Promise<JukeboxQueueItem | null> {
    if (this.isPreparingNextTrack) {
      return null
    }

    // If a track is already locked in Spotify's queue, don't prepare another one
    if (this.spotifyQueuedTrackId) {
      return null
    }

    this.isPreparingNextTrack = true

    try {
      // Refresh queue to ensure we have latest data
      await this.refreshQueueFromAPI()

      // Get next track from queue
      let nextTrack = this.queueManager.getNextTrack()

      if (!nextTrack) {
        logger('INFO', '[PrepareNextTrack] No next track available in queue')
        return null
      }

      // If the next track in queue is the currently playing track, get the track after it
      // This can happen because we only remove tracks from the queue when they finish,
      // but we prepare the next track 30 seconds before the current one finishes
      if (nextTrack.tracks.spotify_track_id === currentTrackId) {
        logger(
          'INFO',
          '[PrepareNextTrack] Next track in queue is currently playing, getting track after next'
        )
        const trackAfterNext = this.queueManager.getTrackAfterNext()

        if (!trackAfterNext) {
          logger('INFO', '[PrepareNextTrack] No track after current in queue')
          return null
        }

        nextTrack = trackAfterNext
      }

      // Check for active device before attempting to add
      if (!this.deviceId) {
        logger(
          'WARN',
          'No active device - cannot add track to Spotify queue, using prepared-only mode'
        )
        this.nextTrackPrepared = true
        this.preparedTrackId = nextTrack.tracks.spotify_track_id
        return nextTrack
      }

      // Add track to Spotify queue with retry logic
      const trackUri = `spotify:track:${nextTrack.tracks.spotify_track_id}`
      let addSuccess = false
      let lastError: Error | null = null

      // Retry up to 3 times with exponential backoff
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await sendApiRequest({
            path: `me/player/queue?uri=${encodeURIComponent(trackUri)}`,
            method: 'POST'
          })

          // POST succeeded - trust Spotify's API response
          addSuccess = true
          break
        } catch (error: any) {
          lastError = error as Error

          // Check error type
          const status =
            error?.status || (error?.message?.includes('404') ? 404 : 0)

          if (status === 404) {
            logger('WARN', 'No active device found - cannot add to queue')
            break // Don't retry on 404
          } else if (status === 403) {
            logger('WARN', 'Premium required to use queue API')
            break // Don't retry on 403
          } else if (attempt < 3) {
            // Retry on other errors with exponential backoff
            logger(
              'WARN',
              `Queue add failed (attempt ${attempt}/3), retrying...`
            )
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * Math.pow(3, attempt - 1))
            )
          }
        }
      }

      if (addSuccess) {
        // Mark as prepared and store the queued track ID - track successfully added
        this.nextTrackPrepared = true
        this.preparedTrackId = nextTrack.tracks.spotify_track_id
        this.spotifyQueuedTrackId = nextTrack.tracks.spotify_track_id
      } else {
        // Failed to add after retries - use direct play fallback
        logger(
          'ERROR',
          'Failed to add track to Spotify queue after 3 attempts, will use direct play fallback',
          undefined,
          lastError || undefined
        )
        this.nextTrackPrepared = true
        this.preparedTrackId = nextTrack.tracks.spotify_track_id
        // DO NOT set spotifyQueuedTrackId - track is not actually in Spotify's queue
      }

      return nextTrack
    } catch (error) {
      logger('ERROR', 'Failed to prepare next track', undefined, error as Error)
      return null
    } finally {
      this.isPreparingNextTrack = false
    }
  }

  private shouldStartNextTrack(currentState: SpotifyPlaybackState): boolean {
    // Edge case: Don't start if playback is paused
    if (!currentState.item || !currentState.is_playing) {
      return false
    }

    // Don't start if already started
    if (this.nextTrackStarted) {
      return false
    }

    // Only start if we've prepared a track
    if (!this.nextTrackPrepared || !this.preparedTrackId) {
      return false
    }

    // Edge case: Don't start if auto-play is disabled
    if (this.isAutoPlayDisabled) {
      return false
    }

    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const timeRemaining = duration - progress

    // Check if we're within the start threshold
    return (
      timeRemaining > 0 &&
      timeRemaining <= PLAYER_LIFECYCLE_CONFIG.TRACK_START_THRESHOLD_MS
    )
  }

  private async startNextTrackPredictively(): Promise<void> {
    if (!this.preparedTrackId || this.nextTrackStarted) {
      return
    }

    // Prevent concurrent executions
    if (this.isStartingNextTrack) {
      return
    }
    this.isStartingNextTrack = true

    try {
      // If track is locked in Spotify's queue, let it play regardless of database queue
      // Note: Track deletion will be handled when Spotify transitions and we detect the track change
      if (this.spotifyQueuedTrackId === this.preparedTrackId) {
        // Don't call playNextTrack - let Spotify handle the transition
        // Don't clear lock here - it will be cleared when the track change is detected
        // Just mark as started to prevent fallback logic
        this.nextTrackStarted = true
        return
      }

      // For non-locked tracks, delete the currently playing track before transition
      if (this.lastTrackId) {
        const queue = this.queueManager.getQueue()
        const currentQueueItem = queue.find(
          (item) => item.tracks.spotify_track_id === this.lastTrackId
        )

        if (currentQueueItem) {
          try {
            await this.queueManager.markAsPlayed(currentQueueItem.id)
            await this.refreshQueueFromAPI()
          } catch (error) {
            logger(
              'ERROR',
              'Failed to remove finished track',
              undefined,
              error as Error
            )
          }
        }
      }

      // If not in Spotify queue, validate against current database queue
      const nextTrack = this.queueManager.getNextTrack()

      if (!nextTrack) {
        logger('WARN', '[StartNextTrack] No next track available')
        return
      }

      // Validate that prepared track still matches current queue
      if (nextTrack.tracks.spotify_track_id !== this.preparedTrackId) {
        logger(
          'INFO',
          `[StartNextTrack] Queue changed before lock-in - prepared: ${this.preparedTrackId}, current queue: ${nextTrack.tracks.spotify_track_id}`
        )
        // Reset preparation state and don't start - will prepare new track on next cycle
        this.resetPredictiveState('Queue changed before lock-in')
        return
      }

      // Track matches and isn't queued yet - use fallback direct play
      logger(
        'WARN',
        `[StartNextTrack] Track not in Spotify queue, using fallback play: ${nextTrack.tracks.name}`
      )
      await this.playNextTrack(nextTrack, true)
      this.nextTrackStarted = true
    } catch (error) {
      logger('ERROR', 'Failed to start next track', undefined, error as Error)
      this.resetPredictiveState('Error in startNextTrack')
    } finally {
      this.isStartingNextTrack = false
    }
  }

  private resetPredictiveState(reason: string): void {
    if (
      this.nextTrackPrepared ||
      this.preparedTrackId ||
      this.nextTrackStarted
    ) {
      logger(
        'INFO',
        `[ResetPredictiveState] Resetting predictive state - Reason: ${reason}, PreparedTrackId: ${this.preparedTrackId}, NextTrackStarted: ${this.nextTrackStarted}`
      )
    }
    this.nextTrackPrepared = false
    this.preparedTrackId = null
    this.isPreparingNextTrack = false
    this.nextTrackStarted = false
    this.isStartingNextTrack = false
  }

  private validatePreparedTrack(): void {
    // If we have a track in Spotify's queue, it is LOCKED IN and will play next
    // We do NOT try to change it even if the database queue order changes
    if (this.spotifyQueuedTrackId) {
      logger(
        'INFO',
        `[ValidatePreparedTrack] Track locked in Spotify queue: ${this.spotifyQueuedTrackId}, will play regardless of queue changes`
      )
      return
    }

    // If we have a prepared track but it's not yet in Spotify's queue, validate it still matches
    if (!this.preparedTrackId || !this.nextTrackPrepared) {
      return
    }

    const nextTrack = this.queueManager.getNextTrack()

    // If no next track or it doesn't match, reset preparation
    // This can happen if the queue changed BEFORE we added the track to Spotify's queue
    if (
      !nextTrack ||
      nextTrack.tracks.spotify_track_id !== this.preparedTrackId
    ) {
      logger(
        'INFO',
        `[ValidatePreparedTrack] Queue changed before track was locked in - prepared track ${this.preparedTrackId} no longer matches next track ${nextTrack?.tracks.spotify_track_id || 'none'}`
      )
      this.resetPredictiveState('Queue changed in validatePreparedTrack')
    }
  }

  private hasTrackFinished(currentState: SpotifyPlaybackState): boolean {
    if (!this.lastPlaybackState || !currentState.item) {
      return false
    }

    const lastState = this.lastPlaybackState
    const currentTrackId = currentState.item.id
    const lastTrackId = lastState.item?.id

    // If we already processed this track's finish, don't detect it again
    if (this.lastProcessedTrackId === currentTrackId) {
      // Silently return false - no log needed since this happens every poll cycle
      return false
    }

    // More sensitive detection - check multiple conditions
    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const isAtEnd =
      duration > 0 &&
      duration - progress < PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS
    const isSameTrack = currentTrackId === lastTrackId
    const wasPlaying = lastState.is_playing
    const isPaused = !currentState.is_playing
    const isStopped = !currentState.is_playing && progress === 0 // Track stopped and reset to beginning
    const hasProgressed = progress > (lastState.progress_ms || 0) // Track has progressed since last check
    const isNearEnd =
      duration > 0 &&
      duration - progress < PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS / 2 // Very near end
    const hasStalled = !hasProgressed && wasPlaying && isSameTrack // Track has stalled

    // Track finished if:
    // 1. We were playing, now paused/stopped, same track, near end
    // 2. Track stopped and reset to beginning (natural end)
    // 3. Track is at the end and not progressing (stuck at end)
    // 4. Track is very near end and has stalled (new condition for faster detection)
    // 5. Track is paused and very near end (new condition)
    const finished =
      (wasPlaying && (isPaused || isStopped) && isSameTrack && isAtEnd) ||
      (isStopped && isSameTrack) ||
      (isAtEnd && isSameTrack && !hasProgressed && wasPlaying) ||
      (isNearEnd && hasStalled) ||
      (isPaused && isNearEnd && isSameTrack)

    return finished
  }

  private async handleTrackFinished(
    trackId: string | undefined
  ): Promise<void> {
    if (!trackId) {
      logger(
        'WARN',
        'Track finished but no track ID provided to handleTrackFinished'
      )
      return
    }

    // Prevent processing the same track multiple times
    if (this.lastProcessedTrackId === trackId) {
      return
    }
    this.lastProcessedTrackId = trackId
    this.onTrackFinished?.(trackId)

    try {
      // Don't delete the track here - it will be deleted when the NEXT track starts
      // This prevents duplicate deletion attempts during the transition period

      // Check if queue is getting low and trigger auto-fill if needed
      await this.checkAndAutoFillQueue()

      // Check if next track was already started predictively (locked in Spotify queue)
      if (this.nextTrackStarted) {
        // Track deletion already handled by track change detection
        // Just reset the state for the next cycle
        this.lastProcessedTrackId = null
        this.resetPredictiveState('Locked track transition successful')
        return
      }

      // Get the next track from the queue
      let nextTrack = this.queueManager.getNextTrack()

      // Validate that the next track is not the same as the finished track
      // This prevents repeating a song when markAsPlayed fails
      if (nextTrack && nextTrack.tracks.spotify_track_id === trackId) {
        logger(
          'ERROR',
          `[handleTrackFinished] Next track matches finished track (${trackId}) - queue sync issue detected. Attempting to remove duplicate.`
        )

        // Try to remove the duplicate track again
        try {
          await this.queueManager.markAsPlayed(nextTrack.id)
          logger(
            'INFO',
            `[handleTrackFinished] Successfully removed duplicate track on retry: ${nextTrack.id}`
          )
          // Get the next track again after removal
          nextTrack = this.queueManager.getNextTrack()
        } catch (retryError) {
          logger(
            'ERROR',
            '[handleTrackFinished] Failed to remove duplicate track on retry',
            undefined,
            retryError as Error
          )
          // Don't play the same track - set nextTrack to undefined
          nextTrack = undefined
        }
      }

      if (nextTrack) {
        // Check if auto-play is disabled (e.g., during manual refresh)
        if (this.isAutoPlayDisabled) {
          logger(
            'INFO',
            '[handleTrackFinished] Auto-play is disabled, skipping automatic playback'
          )
          return
        }

        // Fallback: play next track reactively
        logger(
          'INFO',
          '[handleTrackFinished] Starting next track reactively (fallback)'
        )
        await this.playNextTrack(nextTrack, false)

        // Clear spotifyQueuedTrackId since we're using direct play (not the queue)
        if (this.spotifyQueuedTrackId) {
          logger(
            'INFO',
            `[handleTrackFinished] Clearing spotifyQueuedTrackId after fallback play: ${this.spotifyQueuedTrackId}`
          )
          this.spotifyQueuedTrackId = null
        }
      } else {
        this.onQueueEmpty?.()
        // Clear spotifyQueuedTrackId since there's no next track
        if (this.spotifyQueuedTrackId) {
          logger(
            'INFO',
            `[handleTrackFinished] Clearing spotifyQueuedTrackId (queue empty): ${this.spotifyQueuedTrackId}`
          )
          this.spotifyQueuedTrackId = null
        }
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error handling track finished',
        undefined,
        error as Error
      )
    }
  }

  private async refreshQueueFromAPI(): Promise<number | null> {
    if (!this.username) {
      logger('WARN', '[refreshQueueFromAPI] No username available')
      return null
    }

    try {
      const response = await fetch(`/api/playlist/${this.username}`)

      if (!response.ok) {
        logger(
          'WARN',
          `[refreshQueueFromAPI] API response not ok: ${response.status} ${response.statusText}`
        )
        return null
      }

      const queue = (await response.json()) as JukeboxQueueItem[]
      const cachedQueueLength = this.queueManager.getQueue().length

      this.queueManager.updateQueue(queue)

      logger(
        'INFO',
        `[refreshQueueFromAPI] Queue refreshed - cached: ${cachedQueueLength}, fresh: ${queue.length}`
      )

      return queue.length
    } catch (error) {
      logger(
        'WARN',
        '[refreshQueueFromAPI] Failed to refresh queue from API',
        undefined,
        error as Error
      )
      return null
    }
  }

  private async checkAndAutoFillQueue(): Promise<void> {
    // Refresh queue from API to get accurate current size
    const cachedQueue = this.queueManager.getQueue()
    const cachedQueueLength = cachedQueue.length

    const freshQueueLength = await this.refreshQueueFromAPI()
    const currentQueueLength = freshQueueLength ?? cachedQueueLength

    if (freshQueueLength === null && cachedQueueLength > 0) {
      logger(
        'WARN',
        `[checkAndAutoFillQueue] Using cached queue data (${cachedQueueLength} tracks) - API refresh failed`
      )
    } else if (
      freshQueueLength !== null &&
      freshQueueLength !== cachedQueueLength
    ) {
      logger(
        'INFO',
        `[checkAndAutoFillQueue] Queue size mismatch detected - cached: ${cachedQueueLength}, fresh: ${freshQueueLength}`
      )
    }

    // Check if queue is low (below target size)
    if (
      currentQueueLength < this.autoFillTargetSize &&
      !this.isAutoFilling &&
      this.username &&
      this.isInitialized
    ) {
      // Additional check to ensure we have valid track suggestions state or fallback defaults
      const hasValidState = this.trackSuggestionsState || true // Always allow auto-fill with fallbacks
      logger(
        'INFO',
        `[checkAndAutoFillQueue] Triggering auto-fill - queue: ${currentQueueLength}/${this.autoFillTargetSize} tracks`
      )
      this.onQueueLow?.()

      try {
        this.isAutoFilling = true

        // Small delay to ensure track suggestions state is properly loaded
        if (!this.trackSuggestionsState) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else {
          // Validate that track suggestions state has required fields
          const requiredFields = [
            'genres',
            'yearRange',
            'popularity',
            'allowExplicit',
            'maxSongLength',
            'maxOffset',
            'autoFillTargetSize'
          ]
          const missingFields = requiredFields.filter(
            (field: string) => !(field in this.trackSuggestionsState)
          )

          if (missingFields.length > 0) {
            logger(
              'WARN',
              `[checkAndAutoFillQueue] Track suggestions state missing fields: ${missingFields.join(', ')}`
            )
            logger(
              'WARN',
              `[checkAndAutoFillQueue] Track suggestions state: ${JSON.stringify(this.trackSuggestionsState)}`
            )
          }
        }

        await this.autoFillQueue()
      } catch (error) {
        logger(
          'ERROR',
          '[checkAndAutoFillQueue] Failed to auto-fill queue',
          undefined,
          error as Error
        )
      } finally {
        this.isAutoFilling = false
      }
    } else {
      // Log why auto-fill was not triggered
      const reasons: string[] = []
      if (currentQueueLength >= this.autoFillTargetSize) {
        reasons.push(
          `queue size (${currentQueueLength}) >= target (${this.autoFillTargetSize})`
        )
      }
      if (this.isAutoFilling) {
        reasons.push('auto-fill already in progress')
      }
      if (!this.username) {
        reasons.push('no username available')
      }
      if (!this.isInitialized) {
        reasons.push('service not initialized')
      }

      logger(
        'INFO',
        `[checkAndAutoFillQueue] Auto-fill not triggered - queue: ${currentQueueLength}/${this.autoFillTargetSize} tracks. Reasons: ${reasons.join(', ') || 'none (should not happen)'}`
      )
    }
  }

  private async autoFillQueue(): Promise<void> {
    if (!this.username) {
      logger('ERROR', 'No username available for auto-fill')
      return
    }

    // Check if we have valid track suggestions state
    if (!this.trackSuggestionsState) {
      logger(
        'WARN',
        '[AutoFill] No track suggestions state available, using fallback defaults'
      )
      logger(
        'WARN',
        '[AutoFill] Track suggestions state is null/undefined - this indicates the state was not properly set'
      )
    }

    const targetQueueSize = this.autoFillTargetSize // Target number of tracks in queue
    const maxAttempts = this.autoFillMaxAttempts // Maximum attempts to prevent infinite loops
    let attempts = 0
    let tracksAdded = 0

    while (attempts < maxAttempts) {
      attempts++

      // Check current queue size
      const currentQueue = this.queueManager.getQueue()
      const currentQueueSize = currentQueue.length

      // If we've reached the target, stop
      if (currentQueueSize >= targetQueueSize) {
        break
      }

      try {
        // Use user's track suggestions configuration for auto-fill with fallback defaults
        // Handle the case where trackSuggestionsState might be null or undefined
        const mergedTrackSuggestions = {
          genres:
            Array.isArray(this.trackSuggestionsState?.genres) &&
            this.trackSuggestionsState.genres.length > 0
              ? this.trackSuggestionsState.genres.filter(
                  (genre: any) => typeof genre === 'string'
                )
              : [...FALLBACK_GENRES],
          yearRange: Array.isArray(this.trackSuggestionsState?.yearRange)
            ? ([
                Math.max(
                  1900,
                  Math.min(
                    new Date().getFullYear(),
                    Math.floor(this.trackSuggestionsState.yearRange[0] ?? 1900)
                  )
                ),
                Math.max(
                  1900,
                  Math.min(
                    new Date().getFullYear(),
                    Math.floor(
                      this.trackSuggestionsState.yearRange[1] ??
                        new Date().getFullYear()
                    )
                  )
                )
              ] as [number, number])
            : DEFAULT_YEAR_RANGE,
          popularity: Math.max(
            0,
            Math.min(
              100,
              this.trackSuggestionsState?.popularity ?? MIN_TRACK_POPULARITY
            )
          ),
          allowExplicit: Boolean(
            this.trackSuggestionsState?.allowExplicit ?? true
          ),
          maxSongLength: Math.max(
            3,
            Math.min(
              20,
              this.trackSuggestionsState?.maxSongLength ??
                DEFAULT_MAX_SONG_LENGTH_MINUTES
            )
          ),
          maxOffset: Math.max(
            1,
            Math.min(
              10000,
              this.trackSuggestionsState?.maxOffset ?? DEFAULT_MAX_OFFSET
            )
          )
        }

        const requestBody = {
          ...mergedTrackSuggestions
        }

        // Validate that all required fields are present
        const requiredFields = [
          'genres',
          'yearRange',
          'popularity',
          'allowExplicit',
          'maxSongLength',
          'maxOffset'
        ]
        const missingFields = requiredFields.filter(
          (field: string) => !(field in requestBody)
        )

        if (missingFields.length > 0) {
          logger(
            'ERROR',
            `[AutoFill] Missing required fields: ${missingFields.join(', ')}`
          )
          logger(
            'ERROR',
            `[AutoFill] Request body: ${JSON.stringify(requestBody)}`
          )
          logger(
            'ERROR',
            `[AutoFill] Request body keys: ${Object.keys(requestBody).join(', ')}`
          )
          logger(
            'ERROR',
            `[AutoFill] Track suggestions state that was used: ${JSON.stringify(this.trackSuggestionsState)}`
          )
          throw new Error(
            `Missing required fields: ${missingFields.join(', ')}`
          )
        }

        // Get current queue to exclude existing tracks
        const currentQueue = this.queueManager.getQueue()
        let excludedTrackIds = currentQueue.map(
          (item) => item.tracks.spotify_track_id
        )

        // Also exclude tracks from recent cooldown history (24-hour filter)
        try {
          const { loadCooldownState, getTracksInCooldown } = await import(
            '@/shared/utils/suggestionsCooldown'
          )
          const contextId = this.username ?? 'default'
          const cooldown = loadCooldownState(contextId)
          const tracksInCooldown = getTracksInCooldown(cooldown)
          if (tracksInCooldown.length > 0) {
            logger(
              'INFO',
              `[AutoFill] Including ${tracksInCooldown.length} tracks in 24-hour cooldown into exclusions for context=${contextId}`
            )
            excludedTrackIds = Array.from(
              new Set([...excludedTrackIds, ...tracksInCooldown])
            )
            logger(
              'INFO',
              `[AutoFill] Exclusions total after cooldown merge: ${excludedTrackIds.length}`
            )
          }
        } catch {}

        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Excluding ${excludedTrackIds.length} existing tracks from suggestions`
        )

        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - TRACK SUGGESTIONS STATE: ${JSON.stringify(this.trackSuggestionsState)}`
        )
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - MERGED TRACK SUGGESTIONS: ${JSON.stringify(mergedTrackSuggestions)}`
        )
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - FINAL REQUEST BODY: ${JSON.stringify(requestBody)}`
        )
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - REQUEST BODY TYPES: ${JSON.stringify(
            {
              genres: typeof requestBody.genres,
              yearRange: typeof requestBody.yearRange,
              popularity: typeof requestBody.popularity,
              allowExplicit: typeof requestBody.allowExplicit,
              maxSongLength: typeof requestBody.maxSongLength,
              maxOffset: typeof requestBody.maxOffset
            }
          )}`
        )
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Sending request: ${JSON.stringify(requestBody)}`
        )

        let response: Response
        let errorBody: any

        try {
          response = await fetch('/api/track-suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...requestBody,
              excludedTrackIds
            })
          })

          logger(
            'INFO',
            `[AutoFill] Attempt ${attempts} - RESPONSE RECEIVED - Status: ${response.status}`
          )

          if (!response.ok) {
            logger(
              'ERROR',
              `[AutoFill] Attempt ${attempts} - REQUEST FAILED - Status: ${response.status}`
            )

            try {
              errorBody = await response.json()
              logger(
                'ERROR',
                `[AutoFill] Attempt ${attempts} - ERROR BODY: ${JSON.stringify(errorBody)}`
              )

              if (response.status === 400 && errorBody.errors) {
                // Log validation errors
                if (Array.isArray(errorBody.errors)) {
                  errorBody.errors.forEach((error: any, index: number) => {
                    logger(
                      'ERROR',
                      `[AutoFill] Attempt ${attempts} - Validation error ${index + 1}: Field "${error.field}" - ${error.message}`
                    )
                  })
                }
              }
            } catch (parseError) {
              logger(
                'ERROR',
                `[AutoFill] Attempt ${attempts} - Failed to parse error response: ${parseError}`
              )
            }

            // Handle different types of 400 errors
            if (response.status === 400) {
              if (errorBody && errorBody.errors) {
                // Validation error - log the validation errors
                logger(
                  'ERROR',
                  `[AutoFill] Attempt ${attempts} - Validation error detected: ${JSON.stringify(errorBody.errors)}`
                )
                throw new Error(
                  'Track suggestions validation failed. Please check your parameters.'
                )
              } else if (
                errorBody &&
                errorBody.success === false &&
                errorBody.message
              ) {
                // No suitable tracks found - log the detailed error and inform user
                logger(
                  'WARN',
                  `[AutoFill] Attempt ${attempts} - No suitable tracks found: ${errorBody.message}`
                )

                if (errorBody.searchDetails) {
                  logger(
                    'INFO',
                    `[AutoFill] Attempt ${attempts} - Search details: ${JSON.stringify(errorBody.searchDetails)}`
                  )

                  if (errorBody.searchDetails.suggestions) {
                    logger(
                      'INFO',
                      `[AutoFill] Attempt ${attempts} - Suggestions for user: ${errorBody.searchDetails.suggestions.join(', ')}`
                    )
                  }
                }

                // Inform user about why no tracks were found
                const errorMessage = errorBody.message
                const suggestions = errorBody.searchDetails?.suggestions || []

                logger(
                  'INFO',
                  `[AutoFill] Attempt ${attempts} - Informing user: ${errorMessage}. Suggestions: ${suggestions.join(', ')}`
                )

                // Don't try with different parameters - just inform the user
                throw new Error(
                  `No tracks found with your current settings. ${suggestions.length > 0 ? `Suggestions: ${suggestions.join(', ')}` : ''}`
                )
              }
            }

            throw new Error('Failed to get track suggestions for auto-fill.')
          }
        } catch (fetchError) {
          logger(
            'ERROR',
            `[AutoFill] Attempt ${attempts} - FETCH ERROR: ${fetchError}`
          )
          throw new Error('Failed to get track suggestions for auto-fill.')
        }

        const suggestions = (await response.json()) as {
          tracks: { id: string }[]
        }

        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Track suggestions response: ${JSON.stringify(suggestions)}`
        )

        // If no tracks were suggested, try fallback
        if (!suggestions.tracks || suggestions.tracks.length === 0) {
          logger(
            'WARN',
            `[AutoFill] Attempt ${attempts} - No track suggestions received, trying fallback`
          )
          throw new Error('No track suggestions available')
        }

        // Add suggested tracks to the queue
        for (const track of suggestions.tracks) {
          // Check queue size before processing each track
          const queueBeforeTrack = this.queueManager.getQueue()
          const queueSizeBeforeTrack = queueBeforeTrack.length

          if (queueSizeBeforeTrack >= targetQueueSize) {
            logger(
              'INFO',
              `[AutoFill] Target queue size already reached (${queueSizeBeforeTrack}/${targetQueueSize}), stopping track processing`
            )
            return
          }

          try {
            logger(
              'INFO',
              `[AutoFill] Attempt ${attempts} - Fetching full details for track: ${track.id}`
            )

            // Fetch full track details from Spotify
            const trackDetails = await sendApiRequest<{
              id: string
              name: string
              artists: Array<{ id: string; name: string }>
              album: {
                name: string
                images: Array<{ url: string }>
                release_date?: string
              }
              duration_ms: number
              popularity: number
              uri: string
              explicit: boolean
            }>({
              path: `tracks/${track.id}`,
              method: 'GET'
            })

            logger(
              'INFO',
              `[AutoFill] Attempt ${attempts} - Track details: ${JSON.stringify(
                {
                  name: trackDetails.name,
                  artist: trackDetails.artists[0]?.name,
                  duration_ms: trackDetails.duration_ms,
                  popularity: trackDetails.popularity
                }
              )}`
            )

            // Add track to queue
            const playlistResponse = await fetch(
              `/api/playlist/${this.username}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tracks: trackDetails,
                  initialVotes: 1, // Auto-fill tracks get 1 vote
                  source: 'system' // Mark as system-initiated
                })
              }
            )

            if (!playlistResponse.ok) {
              const playlistError = await playlistResponse.json()

              // Handle 409 conflicts (track already in playlist) - this is not an error for auto-fill
              if (playlistResponse.status === 409) {
                logger(
                  'INFO',
                  `[AutoFill] Attempt ${attempts} - Track already in playlist: ${trackDetails.name}, skipping`
                )
                continue // Skip this track and try the next one
              }

              logger(
                'ERROR',
                `[AutoFill] Attempt ${attempts} - Failed to add track to playlist: ${JSON.stringify(playlistError)}`
              )
            } else {
              tracksAdded++
              logger(
                'INFO',
                `[AutoFill] Attempt ${attempts} - Successfully added track to queue: ${trackDetails.name} (Total added: ${tracksAdded})`
              )

              // Check if we've reached the target queue size after adding this track
              const currentQueueAfterAdd = this.queueManager.getQueue()
              const currentQueueSizeAfterAdd = currentQueueAfterAdd.length

              if (currentQueueSizeAfterAdd >= targetQueueSize) {
                logger(
                  'INFO',
                  `[AutoFill] Target queue size reached after adding track (${currentQueueSizeAfterAdd}/${targetQueueSize}), stopping auto-fill`
                )
                // Break out of both the track loop and the attempt loop
                return
              }

              // Record track addition with timestamp for 24-hour cooldown
              try {
                const {
                  loadCooldownState,
                  recordTrackAddition,
                  saveCooldownState
                } = await import('@/shared/utils/suggestionsCooldown')
                const contextId = this.username ?? 'default'
                const cooldown = loadCooldownState(contextId)
                const updated = recordTrackAddition(cooldown, trackDetails.id)
                saveCooldownState(contextId, updated)
                logger(
                  'INFO',
                  `[AutoFill] Recorded track addition to 24-hour cooldown (context=${contextId}, trackId=${trackDetails.id}, totalTracked=${Object.keys(updated.trackTimestamps).length})`
                )
              } catch {}
            }

            // Update the last suggested track cache
            try {
              // Fetch artist genres for the track
              let artistGenres: string[] = []
              try {
                if (trackDetails.artists && trackDetails.artists.length > 0) {
                  const artistId = trackDetails.artists[0].id
                  const artistResponse = await fetch(
                    `https://api.spotify.com/v1/artists/${artistId}`,
                    {
                      headers: {
                        Authorization: `Bearer ${await this.getAccessToken()}`
                      }
                    }
                  )

                  if (artistResponse.ok) {
                    const artistData = await artistResponse.json()
                    artistGenres = artistData.genres || []
                  }
                }
              } catch (genreError) {
                logger(
                  'WARN',
                  `[AutoFill] Attempt ${attempts} - Failed to fetch artist genres: ${genreError instanceof Error ? genreError.message : 'Unknown error'}`
                )
                // Continue with empty genres array if fetch fails
              }

              await fetch('/api/track-suggestions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: trackDetails.name,
                  artist: trackDetails.artists[0]?.name || 'Unknown Artist',
                  album: trackDetails.album.name,
                  uri: trackDetails.uri,
                  popularity: trackDetails.popularity,
                  duration_ms: trackDetails.duration_ms,
                  preview_url: null, // Spotify API doesn't return preview_url in track details
                  genres: artistGenres
                })
              })
              logger(
                'INFO',
                `[AutoFill] Attempt ${attempts} - Updated last suggested track cache: ${trackDetails.name}`
              )
            } catch (cacheError) {
              logger(
                'WARN',
                `[AutoFill] Attempt ${attempts} - Failed to update last suggested track cache: ${cacheError}`
              )
            }

            // Extract metadata for notification
            const albumArtUrl =
              trackDetails.album.images && trackDetails.album.images.length > 0
                ? (trackDetails.album.images[0]?.url ?? null)
                : null

            const notificationMetadata = {
              trackName: trackDetails.name,
              artistName: trackDetails.artists[0]?.name || 'Unknown Artist',
              albumName: trackDetails.album.name,
              albumArtUrl,
              allArtists: trackDetails.artists.map((artist) => artist.name),
              durationMs: trackDetails.duration_ms,
              popularity: trackDetails.popularity,
              explicit: trackDetails.explicit,
              isFallback: false
            }

            logger(
              'INFO',
              `[AutoFill] Notification metadata: ${JSON.stringify({
                trackName: notificationMetadata.trackName,
                albumName: notificationMetadata.albumName,
                hasAlbumArt: !!notificationMetadata.albumArtUrl,
                durationMs: notificationMetadata.durationMs,
                popularity: notificationMetadata.popularity,
                explicit: notificationMetadata.explicit,
                allArtists: notificationMetadata.allArtists
              })}`
            )

            // Show popup notification for auto-added track
            this.showAutoFillNotification(notificationMetadata)
          } catch (error) {
            logger(
              'ERROR',
              `[AutoFill] Attempt ${attempts} - Failed to add track ${track.id} to queue`,
              undefined,
              error as Error
            )
          }
        }

        // Small delay between attempts to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (error) {
        logger(
          'ERROR',
          `[AutoFill] Attempt ${attempts} - Auto-fill failed, trying fallback random track`,
          undefined,
          error as Error
        )
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Error details: ${error instanceof Error ? error.message : 'Unknown error'}`
        )

        // Fallback: Get a random track from the database
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Calling fallbackToRandomTrack...`
        )
        const fallbackSuccess = await this.fallbackToRandomTrack()
        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - FallbackToRandomTrack completed with success: ${fallbackSuccess}`
        )

        if (fallbackSuccess) {
          tracksAdded++

          // Check if we've reached the target queue size after fallback
          const currentQueueAfterFallback = this.queueManager.getQueue()
          const currentQueueSizeAfterFallback = currentQueueAfterFallback.length

          if (currentQueueSizeAfterFallback >= targetQueueSize) {
            logger(
              'INFO',
              `[AutoFill] Target queue size reached after fallback (${currentQueueSizeAfterFallback}/${targetQueueSize}), stopping auto-fill`
            )
            return
          }
        }

        // Small delay between fallback attempts
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      if (attempts >= maxAttempts) {
        logger(
          'WARN',
          `[AutoFill] Reached maximum attempts (${maxAttempts}), stopping auto-fill process`
        )
      }

      const finalQueueSize = this.queueManager.getQueue().length
    }
  }

  private async fallbackToRandomTrack(): Promise<boolean> {
    if (!this.username) {
      logger('ERROR', '[Fallback] No username available for fallback')
      return false
    }

    logger(
      'INFO',
      `[Fallback] Starting fallback to random track for username: ${this.username}`
    )

    // Get current queue to exclude existing tracks
    const currentQueue = this.queueManager.getQueue()
    let excludedTrackIds = currentQueue.map(
      (item) => item.tracks.spotify_track_id
    )

    // Also exclude tracks from recent cooldown history (24-hour filter)
    try {
      const { loadCooldownState, getTracksInCooldown } = await import(
        '@/shared/utils/suggestionsCooldown'
      )
      const contextId = this.username ?? 'default'
      const cooldown = loadCooldownState(contextId)
      const tracksInCooldown = getTracksInCooldown(cooldown)
      if (tracksInCooldown.length > 0) {
        logger(
          'INFO',
          `[Fallback] Including ${tracksInCooldown.length} tracks in 24-hour cooldown into exclusions`
        )
        excludedTrackIds = Array.from(
          new Set([...excludedTrackIds, ...tracksInCooldown])
        )
      }
    } catch {}

    let attempts = 0
    const maxAttempts = 5
    while (attempts < maxAttempts) {
      attempts++
      try {
        const requestBody = { username: this.username, excludedTrackIds }
        logger(
          'INFO',
          `[Fallback] Sending random track request (attempt ${attempts}): ${JSON.stringify(requestBody)}`
        )

        const response = await fetch('/api/random-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
          const errorBody = await response.json()
          logger(
            'ERROR',
            `[Fallback] Random track API error: ${JSON.stringify(errorBody)}`
          )
          if (response.status === 404) {
            // No tracks available after exclusion
            return false
          }
          throw new Error('Failed to get random track for fallback.')
        }

        const result = (await response.json()) as {
          success: boolean
          track: {
            id: string
            spotify_track_id: string
            name: string
            artist: string
            album: string
            duration_ms: number
            popularity: number
            spotify_url: string
          }
        }

        logger(
          'INFO',
          `[Fallback] Random track response: ${JSON.stringify(result)}`
        )

        if (result.success && result.track) {
          // Double-check exclusion (shouldn't be needed, but just in case)
          if (excludedTrackIds.includes(result.track.spotify_track_id)) {
            logger(
              'WARN',
              `[Fallback] Received duplicate track (already in playlist): ${result.track.name}, retrying...`
            )
            continue
          }

          logger(
            'INFO',
            `[Fallback] Adding random track to queue: ${result.track.name} by ${result.track.artist}`
          )

          // Add the random track to the queue
          const playlistResponse = await fetch(
            `/api/playlist/${this.username}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tracks: {
                  id: result.track.spotify_track_id, // Use Spotify track ID, not database UUID
                  name: result.track.name,
                  artists: [{ name: result.track.artist }],
                  album: { name: result.track.album },
                  duration_ms: result.track.duration_ms,
                  popularity: result.track.popularity,
                  uri: result.track.spotify_url
                },
                initialVotes: 1, // Fallback tracks get 1 vote
                source: 'fallback' // Mark as fallback-initiated
              })
            }
          )

          if (!playlistResponse.ok) {
            const playlistError = await playlistResponse.json()
            if (playlistResponse.status === 409) {
              logger(
                'INFO',
                `[Fallback] Track already in playlist (409): ${result.track.name}, retrying...`
              )
              continue
            }
            logger(
              'ERROR',
              `[Fallback] Failed to add random track to playlist: ${JSON.stringify(playlistError)}`
            )
            return false
          } else {
          }

          // Record track addition with timestamp for 24-hour cooldown
          try {
            const {
              loadCooldownState,
              recordTrackAddition,
              saveCooldownState
            } = await import('@/shared/utils/suggestionsCooldown')
            const contextId = this.username ?? 'default'
            const cooldown = loadCooldownState(contextId)
            const updated = recordTrackAddition(
              cooldown,
              result.track.spotify_track_id
            )
            saveCooldownState(contextId, updated)
            logger(
              'INFO',
              `[Fallback] Recorded track addition to 24-hour cooldown (trackId=${result.track.spotify_track_id})`
            )
          } catch {}

          // Show popup notification for fallback track
          this.showAutoFillNotification({
            trackName: result.track.name,
            artistName: result.track.artist,
            albumName: result.track.album,
            albumArtUrl: null, // Fallback tracks from database don't have album art
            allArtists: [result.track.artist],
            durationMs: result.track.duration_ms,
            popularity: result.track.popularity,
            explicit: null, // Database doesn't store explicit flag
            isFallback: true
          })
          return true
        } else {
          logger('ERROR', '[Fallback] No random track available for fallback')
          return false
        }
      } catch (error) {
        logger(
          'ERROR',
          '[Fallback] Fallback to random track failed',
          undefined,
          error as Error
        )
      }
    }
    logger(
      'WARN',
      '[Fallback] Exceeded max attempts to find a unique random track'
    )
    return false
  }

  private showAutoFillNotification(trackMetadata: {
    trackName: string
    artistName: string
    albumName?: string
    albumArtUrl?: string | null
    allArtists?: string[]
    durationMs?: number
    popularity?: number
    explicit?: boolean | null
    isFallback?: boolean
  }): void {
    // Only dispatch events on the client side
    if (typeof window !== 'undefined') {
      // Create a custom event to trigger the notification
      const event = new CustomEvent('autoFillNotification', {
        detail: {
          trackName: trackMetadata.trackName,
          artistName: trackMetadata.artistName,
          albumName: trackMetadata.albumName,
          albumArtUrl: trackMetadata.albumArtUrl ?? null,
          allArtists: trackMetadata.allArtists ?? [trackMetadata.artistName],
          durationMs: trackMetadata.durationMs,
          popularity: trackMetadata.popularity,
          explicit: trackMetadata.explicit ?? null,
          isFallback: trackMetadata.isFallback ?? false,
          timestamp: Date.now()
        }
      })

      // Dispatch the event on the window object
      window.dispatchEvent(event)
    }
  }

  private async playNextTrack(
    track: JukeboxQueueItem,
    isPredictive: boolean = false
  ): Promise<void> {
    if (!this.deviceId) {
      logger('ERROR', 'No device ID available to play next track')
      return
    }

    try {
      const trackUri = `spotify:track:${track.tracks.spotify_track_id}`

      logger(
        'INFO',
        `[playNextTrack] Playing track ${track.tracks.name} (${isPredictive ? 'predictive' : 'reactive'})`
      )

      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: this.deviceId,
          uris: [trackUri]
        }
      })

      this.onNextTrackStarted?.(track)
    } catch (error) {
      logger('ERROR', 'Failed to play next track', undefined, error as Error)
      // Reset predictive state on error
      if (isPredictive) {
        this.resetPredictiveState('Error in playNextTrack')
      }
    }
  }

  private async getAccessToken(): Promise<string | null> {
    try {
      // Use the existing sendApiRequest to get a token
      // This will use the admin credentials from the database
      const response = await sendApiRequest<{ access_token: string }>({
        path: 'token',
        method: 'GET',
        isLocalApi: true
      })

      return response?.access_token || null
    } catch (error) {
      logger('ERROR', 'Failed to get access token', undefined, error as Error)
      return null
    }
  }

  private async getCurrentPlaybackState(): Promise<SpotifyPlaybackState | null> {
    try {
      return await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })
    } catch (error) {
      logger(
        'ERROR',
        'Failed to get current playback state',
        undefined,
        error as Error
      )
      return null
    }
  }

  public isActive(): boolean {
    return this.isRunning
  }

  public getLastTrackId(): string | null {
    return this.lastTrackId
  }

  public getLockedTrackId(): string | null {
    return this.spotifyQueuedTrackId
  }

  public async resetAfterSeek(): Promise<void> {
    // Reset predictive state after seeking to prevent stale preparation
    if (
      this.nextTrackPrepared ||
      this.preparedTrackId ||
      this.spotifyQueuedTrackId
    ) {
      logger('INFO', 'Resetting predictive state after seek operation')
      this.resetPredictiveState('Seek operation')
    }

    // Immediately check playback state to see if we need to prepare next track
    // This handles edge case where user seeks to near the end of a song
    try {
      const currentState = await this.getCurrentPlaybackState()
      if (currentState?.item?.id && currentState.is_playing) {
        const progress = currentState.progress_ms || 0
        const duration = currentState.item.duration_ms || 0
        const timeRemaining = duration - progress

        // If we're within 15 seconds of the end after seeking, immediately prepare next track
        if (timeRemaining > 0 && timeRemaining <= 15000) {
          logger(
            'INFO',
            `After seek: ${timeRemaining}ms remaining - immediately preparing next track`
          )
          await this.prepareNextTrack(currentState.item.id)
        }
      }
    } catch (error) {
      logger(
        'WARN',
        'Failed to check playback state after seek',
        undefined,
        error as Error
      )
    }
  }

  public getStatus(): {
    isRunning: boolean
    deviceId: string | null
    username: string | null
    isAutoPlayDisabled: boolean
    isInitialized: boolean
    queueLength: number
  } {
    return {
      isRunning: this.isRunning,
      deviceId: this.deviceId,
      username: this.username,
      isAutoPlayDisabled: this.isAutoPlayDisabled,
      isInitialized: this.isInitialized,
      queueLength: this.queueManager.getQueue().length
    }
  }
}

// Global singleton instance that survives hot reloads
declare global {
  interface Window {
    __autoPlayServiceInstance?: AutoPlayService
  }
}

// Singleton instance
let autoPlayServiceInstance: AutoPlayService | null = null

export function getAutoPlayService(
  config?: AutoPlayServiceConfig
): AutoPlayService {
  // In browser, use global instance to survive hot reloads
  if (typeof window !== 'undefined') {
    if (window.__autoPlayServiceInstance) {
      return window.__autoPlayServiceInstance
    }
  }

  if (!autoPlayServiceInstance) {
    autoPlayServiceInstance = new AutoPlayService(config)
    // Store in global scope
    if (typeof window !== 'undefined') {
      window.__autoPlayServiceInstance = autoPlayServiceInstance
    }
  }
  return autoPlayServiceInstance
}

export function resetAutoPlayService(): void {
  const instance =
    typeof window !== 'undefined'
      ? window.__autoPlayServiceInstance
      : autoPlayServiceInstance

  if (instance) {
    instance.stop()
    autoPlayServiceInstance = null
    if (typeof window !== 'undefined') {
      delete window.__autoPlayServiceInstance
    }
  }
}

export { AutoPlayService }
