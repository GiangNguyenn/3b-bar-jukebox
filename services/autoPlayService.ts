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
import {
  TrackSuggestionsState,
  isValidTrackSuggestionsState
} from '@/shared/types/trackSuggestions'
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { transferPlaybackToDevice } from '@/services/deviceManagement'
import { buildTrackUri } from '@/shared/utils/spotifyUri'

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
  private duplicateDetector: TrackDuplicateDetector =
    new TrackDuplicateDetector()
  private autoFillTargetSize: number
  private autoFillMaxAttempts: number
  private trackSuggestionsState: TrackSuggestionsState | null = null // User's track suggestions configuration
  private isAutoPlayDisabled: boolean = false // Flag to temporarily disable auto-play during manual operations
  private isInitialized: boolean = false // Flag to track if the service is properly initialized

  constructor(config: AutoPlayServiceConfig = {}) {
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
      // Last 10 seconds: poll every 100ms for better precision (reduced from 250ms)
      newInterval = 100
    } else if (timeRemaining <= 30000) {
      // Last 30 seconds: poll every 250ms (reduced from 500ms)
      newInterval = 250
    } else {
      // Rest of the track: poll every 500ms to reduce API calls (reduced from 1000ms)
      newInterval = 500
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
  }

  public setDeviceId(deviceId: string | null): void {
    this.deviceId = deviceId
  }

  public setUsername(username: string | null): void {
    this.username = username
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    this.queueManager.updateQueue(queue)
    const currentQueueLength = queue.length

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

  public setTrackSuggestionsState(state: TrackSuggestionsState | null): void {
    logger(
      'INFO',
      `[setTrackSuggestionsState] Setting track suggestions state: ${JSON.stringify(state)}`
    )
    logger(
      'INFO',
      `[setTrackSuggestionsState] State type: ${typeof state}, is null: ${state === null}, is undefined: ${state === undefined}`
    )

    // Validate state before setting
    if (state && !isValidTrackSuggestionsState(state)) {
      logger('WARN', 'Invalid track suggestions state provided')
      return
    }

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

        // Proactive safety net: if the service is initialized, auto-play is
        // enabled, and there are tracks waiting in the jukebox queue, delegate
        // starting the next track to PlayerLifecycleService so that all
        // track-to-track transitions go through a single, canonical path.
        if (this.isInitialized && this.username && !this.isAutoPlayDisabled) {
          const nextTrack = this.queueManager.getNextTrack()
          if (nextTrack) {
            logger(
              'INFO',
              '[checkPlaybackState] No playback state but queue has tracks – delegating next track start to PlayerLifecycleService'
            )
            try {
              await playerLifecycleService.playNextFromQueue()
            } catch (error) {
              logger(
                'ERROR',
                '[checkPlaybackState] PlayerLifecycleService failed to start next track from fallback',
                undefined,
                error as Error
              )
            }
          }
        }

        return
      }

      const currentTrackId = currentState.item?.id
      const isPlaying = currentState.is_playing
      const progress = currentState.progress_ms || 0
      const duration = currentState.item?.duration_ms || 0

      // Reset duplicate detector if we're playing a different track
      // Edge case: Manual skip detected
      if (currentTrackId && currentTrackId !== this.lastTrackId) {
        this.duplicateDetector.setLastKnownPlayingTrack(currentTrackId)
      }

      // Fallback: Check if track has finished (for edge cases)
      if (this.hasTrackFinished(currentState)) {
        try {
          await this.handleTrackFinished(currentTrackId)
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

  private hasTrackFinished(currentState: SpotifyPlaybackState): boolean {
    if (!this.lastPlaybackState || !currentState.item) {
      return false
    }

    const lastState = this.lastPlaybackState
    const currentTrackId = currentState.item.id
    const lastTrackId = lastState.item?.id

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
    logger(
      'INFO',
      `[handleTrackFinished] Function called with trackId: ${trackId}`
    )

    if (!trackId) {
      logger('WARN', 'Track finished but no track ID available')
      return
    }

    // Prevent processing the same track multiple times
    if (!this.duplicateDetector.shouldProcessTrack(trackId)) {
      logger(
        'INFO',
        `[handleTrackFinished] Skipping duplicate processing for track: ${trackId}`
      )
      return
    }
    this.onTrackFinished?.(trackId)

    try {
      // Find the queue item with this Spotify track ID
      const queue = this.queueManager.getQueue()
      logger(
        'INFO',
        `[handleTrackFinished] Current queue length: ${queue.length}`
      )
      logger(
        'INFO',
        `[handleTrackFinished] Queue items: ${JSON.stringify(queue.map((item) => ({ id: item.id, spotify_track_id: item.tracks.spotify_track_id, name: item.tracks.name })))}`
      )

      const queueItem = queue.find(
        (item) => item.tracks.spotify_track_id === trackId
      )

      if (queueItem) {
        // Track is in queue - mark it as played
        try {
          await this.queueManager.markAsPlayed(queueItem.id)
          // Small delay to ensure DELETE has propagated to database before refreshing
          // This prevents race conditions where refresh brings back the track that was just deleted
          await new Promise((resolve) => setTimeout(resolve, 200))
          // Refresh queue from API after marking as played to ensure sync
          // This prevents issues where the next track is the same as the finished track
          if (this.username) {
            try {
              const freshQueueLength = await this.refreshQueueFromAPI()
              if (freshQueueLength !== null) {
                logger(
                  'INFO',
                  `[handleTrackFinished] Refreshed queue after markAsPlayed (${freshQueueLength} tracks remaining)`
                )
              }
            } catch (refreshError) {
              logger(
                'WARN',
                '[handleTrackFinished] Failed to refresh queue after markAsPlayed, using cached queue',
                undefined,
                refreshError as Error
              )
            }
          }
        } catch (error) {
          logger(
            'WARN',
            `Failed to mark queue item ${queueItem.id} as played`,
            undefined,
            error as Error
          )
          // Continue with next track even if marking as played fails
        }
      } else {
        logger(
          'WARN',
          `No queue item found for finished trackId: ${trackId}. Track may have been manually started or already removed from queue.`
        )
      }

      // Check if queue is getting low and trigger auto-fill if needed
      await this.checkAndAutoFillQueue()

      // At this point AutoPlayService has updated queue state and ensured
      // auto-fill runs when needed. Playback transitions themselves are
      // handled by PlayerLifecycleService via SDK events, so we no longer
      // attempt to start the next track from here. This avoids race
      // conditions where both services try to control playback.

      // Check if queue is empty after removals/auto-fill
      const nextTrack = this.queueManager.getQueue()[0]
      if (!nextTrack) {
        this.onQueueEmpty?.()
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
          // Guard against null/undefined before field checks
          // Store in local variable to help TypeScript's control flow analysis
          // This prevents the 'in' operator from failing if state becomes null between checks
          const trackSuggestionsState = this.trackSuggestionsState
          if (!trackSuggestionsState) {
            logger(
              'WARN',
              '[checkAndAutoFillQueue] Track suggestions state is null in else block'
            )
            return
          }

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
            (field: string) => !(field in trackSuggestionsState)
          )

          if (missingFields.length > 0) {
            logger(
              'WARN',
              `[checkAndAutoFillQueue] Track suggestions state missing fields: ${missingFields.join(', ')}`
            )
            logger(
              'WARN',
              `[checkAndAutoFillQueue] Track suggestions state: ${JSON.stringify(trackSuggestionsState)}`
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
      logger(
        'ERROR',
        '[playNextTrack] No device ID available to play next track'
      )
      return
    }

    // Log track transition attempt with context
    logger(
      'INFO',
      `[playNextTrack] Starting track transition - Track: ${track.tracks.name} (${track.tracks.spotify_track_id}), Device: ${this.deviceId}, Queue ID: ${track.id}, Mode: ${isPredictive ? 'predictive' : 'reactive'}`
    )

    // Always transfer playback to the app's device before playing
    // Add retry logic with exponential backoff for transfer failures
    let transferred = false
    const maxTransferRetries = 2
    let transferAttempt = 0
    const transferErrors: Error[] = []

    while (!transferred && transferAttempt <= maxTransferRetries) {
      try {
        transferred = await transferPlaybackToDevice(this.deviceId)
      } catch (transferError) {
        transferErrors.push(
          transferError instanceof Error
            ? transferError
            : new Error(String(transferError))
        )
        transferred = false
      }

      if (!transferred) {
        transferAttempt++
        if (transferAttempt <= maxTransferRetries) {
          const retryDelay = 1000 * transferAttempt // Exponential backoff: 1s, 2s
          logger(
            'WARN',
            `[playNextTrack] Device transfer failed (attempt ${transferAttempt}/${maxTransferRetries + 1}), retrying in ${retryDelay}ms... Device: ${this.deviceId}, Track: ${track.tracks.name}`,
            undefined,
            transferErrors[transferErrors.length - 1]
          )
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
        } else {
          logger(
            'WARN',
            `[playNextTrack] Device transfer failed after ${maxTransferRetries + 1} attempts. Attempting to check if device is already active and proceed with playback. Device: ${this.deviceId}, Track: ${track.tracks.name}, Errors: ${transferErrors.length}`,
            undefined,
            transferErrors[transferErrors.length - 1]
          )

          // Fallback: Check if device is already active via alternative method
          try {
            const playbackState = await sendApiRequest<{
              device?: { id: string; is_active: boolean }
              is_playing: boolean
            }>({
              path: 'me/player',
              method: 'GET'
            })

            logger(
              'INFO',
              `[playNextTrack] Fallback device check - Device ID: ${playbackState?.device?.id}, Is Active: ${playbackState?.device?.is_active}, Is Playing: ${playbackState?.is_playing}`
            )

            if (
              playbackState?.device?.id === this.deviceId &&
              playbackState.device.is_active
            ) {
              logger(
                'INFO',
                `[playNextTrack] Device ${this.deviceId} is already active - proceeding with playback despite transfer verification failure`
              )
              transferred = true // Treat as success since device is active
            } else {
              logger(
                'ERROR',
                `[playNextTrack] Device ${this.deviceId} is not active. Current device: ${playbackState?.device?.id || 'none'}, Is Active: ${playbackState?.device?.is_active || false}. Cannot proceed with playback.`
              )
            }
          } catch (fallbackError) {
            logger(
              'WARN',
              `[playNextTrack] Failed to verify device state via fallback method, but attempting playback anyway. Error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
              undefined,
              fallbackError as Error
            )
            // Attempt playback anyway - device might be active but API is having issues
            transferred = true
          }
        }
      }
    }

    if (!transferred) {
      logger(
        'WARN',
        `[playNextTrack] Failed to transfer playback to app device: ${this.deviceId} after all retry attempts. Attempting playback anyway as last resort. Track: ${track.tracks.name}, Queue ID: ${track.id}, Total transfer errors: ${transferErrors.length}`,
        undefined,
        transferErrors[transferErrors.length - 1]
      )
      // Don't return early - attempt playback anyway as last resort
      // Device might be active but transfer API is having issues
      // If playback fails, error recovery in catch block will handle it
    }

    // Defensive check: verify we're not about to play a track that's already playing
    // This is a final safety net to catch edge cases where all other protections failed
    try {
      const currentPlaybackState = await sendApiRequest<{
        item?: { id: string; name: string }
        is_playing: boolean
      }>({
        path: 'me/player',
        method: 'GET'
      })

      if (
        currentPlaybackState?.item &&
        currentPlaybackState.item.id === track.tracks.spotify_track_id &&
        currentPlaybackState.is_playing
      ) {
        logger(
          'WARN',
          `[playNextTrack] Track ${track.tracks.name} (${track.tracks.spotify_track_id}) is already playing. Removing from queue and attempting next track.`
        )
        // Remove duplicate track from queue and try next track
        try {
          await this.queueManager.markAsPlayed(track.id)
          logger(
            'INFO',
            `[playNextTrack] Removed duplicate track from queue: ${track.id}`
          )
        } catch (error) {
          logger(
            'ERROR',
            `[playNextTrack] Failed to remove duplicate track from queue. Track: ${track.tracks.name}, Queue ID: ${track.id}`,
            undefined,
            error as Error
          )
        }

        // Attempt to play the next track instead of returning early
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          logger(
            'INFO',
            `[playNextTrack] Attempting to play next track after duplicate detection: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id}), Queue ID: ${nextTrack.id}`
          )
          try {
            await this.playNextTrack(nextTrack, false)
            return // Success - exit early
          } catch (error) {
            logger(
              'ERROR',
              `[playNextTrack] Failed to play next track after duplicate detection. Track: ${nextTrack.tracks.name}, Queue ID: ${nextTrack.id}`,
              undefined,
              error as Error
            )
            // Error recovery in catch block will handle further attempts
          }
        } else {
          logger(
            'WARN',
            '[playNextTrack] No next track available after duplicate detection'
          )
        }
        return
      }
    } catch (apiError) {
      // If we can't verify, log warning but continue with playback
      logger(
        'WARN',
        '[playNextTrack] Failed to verify current playback state before playing next track, continuing anyway',
        undefined,
        apiError as Error
      )
    }

    try {
      const trackUri = buildTrackUri(track.tracks.spotify_track_id)

      logger(
        'INFO',
        `[playNextTrack] Attempting to play track URI: ${trackUri} on device: ${this.deviceId}, Mode: ${isPredictive ? 'predictive' : 'reactive'}`
      )

      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: this.deviceId,
          uris: [trackUri]
        }
      })

      logger(
        'INFO',
        `[playNextTrack] Successfully started playback of track: ${track.tracks.name} (${track.tracks.spotify_track_id}), Queue ID: ${track.id}`
      )

      // Update queue manager with currently playing track so getNextTrack() excludes it
      this.queueManager.setCurrentlyPlayingTrack(track.tracks.spotify_track_id)

      this.onNextTrackStarted?.(track)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logger(
        'ERROR',
        `[playNextTrack] Failed to play next track. Track: ${track.tracks.name} (${track.tracks.spotify_track_id}), Queue ID: ${track.id}, Device: ${this.deviceId}, Mode: ${isPredictive ? 'predictive' : 'reactive'}`,
        undefined,
        error as Error
      )

      // Check if error is transient (network, timeout) vs permanent (restriction violated)
      const isTransientError =
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT')

      // For transient errors, attempt one retry before giving up
      if (isTransientError) {
        logger(
          'WARN',
          `[playNextTrack] Transient error detected, attempting retry for track: ${track.tracks.name}`
        )
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait 1s before retry
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              device_id: this.deviceId,
              uris: [buildTrackUri(track.tracks.spotify_track_id)]
            }
          })
          logger(
            'INFO',
            `[playNextTrack] Retry successful for track: ${track.tracks.name}`
          )
          this.onNextTrackStarted?.(track)
          return // Success - exit early
        } catch (retryError) {
          logger(
            'ERROR',
            `[playNextTrack] Retry also failed for track: ${track.tracks.name}`,
            undefined,
            retryError as Error
          )
          // Continue with error recovery below
        }
      }

      // Error recovery: attempt to remove problematic track and try next track
      try {
        await this.queueManager.markAsPlayed(track.id)
        logger(
          'INFO',
          `[playNextTrack] Removed problematic track from queue: ${track.id}`
        )

        // Try to play the next track in queue
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          logger(
            'INFO',
            `[playNextTrack] Attempting to play next track after error recovery: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id}), Queue ID: ${nextTrack.id}`
          )
          // Recursively attempt to play next track (non-predictive mode)
          await this.playNextTrack(nextTrack, false)
          // If successful, don't reset predictive state
          return
        } else {
          logger(
            'WARN',
            '[playNextTrack] No next track available after error recovery'
          )
        }
      } catch (recoveryError) {
        logger(
          'ERROR',
          `[playNextTrack] Error recovery failed. Track: ${track.tracks.name}, Queue ID: ${track.id}`,
          undefined,
          recoveryError as Error
        )
      }

      // Only reset predictive state if no recovery was possible
      if (isPredictive) {
        this.resetPredictiveState()
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

  public getLockedTrackId(): string | null {
    // Track locking feature not yet implemented
    // Returns null to indicate no track is currently locked
    return null
  }

  private resetPredictiveState(): void {
    // Reset last playback state to force a fresh check on next poll
    // This prevents stale track preparation after state changes (e.g., seeking)
    this.lastPlaybackState = null
    this.lastTrackId = null
    logger(
      'INFO',
      '[resetPredictiveState] Reset predictive state - forcing fresh playback check'
    )
  }

  public resetAfterSeek(): void {
    // Reset predictive state after seeking to prevent stale track preparation
    // This will also immediately prepare next track if we seeked to near the end
    this.resetPredictiveState()

    // Trigger an immediate playback state check to re-evaluate position
    if (this.isRunning) {
      void this.checkPlaybackState()
    }
  }
}

// Singleton instance
let autoPlayServiceInstance: AutoPlayService | null = null

export function getAutoPlayService(
  config?: AutoPlayServiceConfig
): AutoPlayService {
  if (!autoPlayServiceInstance) {
    autoPlayServiceInstance = new AutoPlayService(config)
  }
  return autoPlayServiceInstance
}

export function resetAutoPlayService(): void {
  if (autoPlayServiceInstance) {
    autoPlayServiceInstance.stop()
    autoPlayServiceInstance = null
  }
}

export { AutoPlayService }
