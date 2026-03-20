import { JukeboxQueueItem } from '@/shared/types/queue'
import { sendApiRequest } from '@/shared/api'
import { QueueManager } from './queueManager'
import { LogLevel } from '@/hooks/ConsoleLogsProvider'
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
  queueCheckInterval?: number // How often to check queue for auto-fill (default: 10000ms)
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
  private isPolling = false // Guard flag to prevent overlapping requests
  private lastQueueCheckTime = 0
  private readonly QUEUE_CHECK_INTERVAL: number // Check queue periodically, not every poll
  private addLog:
    | ((
        level: LogLevel,
        message: string,
        context?: string,
        error?: Error
      ) => void)
    | null = null

  constructor(config: AutoPlayServiceConfig = {}) {
    this.checkInterval = config.checkInterval || 1000 // Increased to 1000ms baseline to reduce API calls
    this.deviceId = config.deviceId || null
    this.onTrackFinished = config.onTrackFinished
    this.onNextTrackStarted = config.onNextTrackStarted
    this.onQueueEmpty = config.onQueueEmpty
    this.onQueueLow = config.onQueueLow
    this.username = config.username || null
    this.autoFillTargetSize = config.autoFillTargetSize || 10 // Default fallback, will be overridden by track suggestions state
    this.autoFillMaxAttempts = config.autoFillMaxAttempts || 20
    this.QUEUE_CHECK_INTERVAL = config.queueCheckInterval || 10000 // Default to 10 seconds
    this.queueManager = QueueManager.getInstance()
  }

  public start(): void {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.isPolling = false // Reset polling state

    // Start with the configured check interval
    this.startPolling()
  }

  private startPolling(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef)
    }

    this.intervalRef = setInterval(() => {
      // Wrap in error handler to prevent interval from continuing on fatal errors
      void this.checkPlaybackState().catch((error) => {
        // Stop the service on fatal error to prevent memory leaks
        this.stop()
      })
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
    let newInterval = 1000 // Default 1000ms baseline to reduce API calls

    if (timeRemaining <= 10000) {
      // Last 10 seconds: poll every 100ms for better precision
      newInterval = 100
    } else if (timeRemaining <= 30000) {
      // Last 30 seconds: poll every 250ms
      newInterval = 250
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
    this.isPolling = false

    if (this.intervalRef) {
      clearInterval(this.intervalRef)
      this.intervalRef = null
    }
  }

  public setDeviceId(deviceId: string | null): void {
    if (this.deviceId !== deviceId) {
      this.deviceId = deviceId
    }
  }

  public setUsername(username: string | null): void {
    this.username = username
  }

  public setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ): void {
    this.addLog = logger
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
      // Use setTimeout to avoid blocking queue update
      setTimeout(() => {
        void this.checkAndAutoFillQueue()
      }, 500)
    }
  }

  public setTrackSuggestionsState(state: TrackSuggestionsState | null): void {
    // Validate state before setting
    if (state && !isValidTrackSuggestionsState(state)) {
      return
    }

    this.trackSuggestionsState = state

    // Update autoFillTargetSize from track suggestions state if available
    if (state?.autoFillTargetSize !== undefined) {
      this.autoFillTargetSize = state.autoFillTargetSize
    }

    // If this is the first time setting the state and we have a queue, trigger an auto-fill check
    if (state && this.isRunning && this.username) {
      const queue = this.queueManager.getQueue()
      if (queue.length < this.autoFillTargetSize) {
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
    // Prevent overlapping polling requests to avoid race conditions
    if (this.isPolling) {
      return
    }

    this.isPolling = true

    try {
      const currentState = await this.getCurrentPlaybackState()

      // Throttled queue checks - only check queue periodically instead of every playback poll
      // This reduces unnecessary API calls and improves performance
      const now = Date.now()
      if (
        this.isInitialized &&
        this.username &&
        now - this.lastQueueCheckTime > this.QUEUE_CHECK_INTERVAL
      ) {
        this.lastQueueCheckTime = now
        void this.checkAndAutoFillQueue()
      }

      if (!currentState) {
        // Proactive safety net: if the service is initialized, auto-play is
        // enabled, and there are tracks waiting in the jukebox queue, delegate
        // starting the next track to PlayerLifecycleService so that all
        // track-to-track transitions go through a single, canonical path.
        if (this.isInitialized && this.username && !this.isAutoPlayDisabled) {
          const nextTrack = this.queueManager.getNextTrack()
          if (nextTrack) {
            try {
              await playerLifecycleService.skipToTrack(nextTrack)
            } catch (error) {}
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
        } catch (error) {}
      }

      // Adjust polling interval based on track progress
      this.adjustPollingInterval(currentState)

      // Update last known state - only store essential fields to minimize memory usage
      // This prevents accumulation of image URLs and other metadata
      this.lastPlaybackState = {
        is_playing: currentState.is_playing,
        progress_ms: currentState.progress_ms,
        item: currentState.item
          ? {
              id: currentState.item.id,
              duration_ms: currentState.item.duration_ms,
              name: currentState.item.name
            }
          : null
      } as SpotifyPlaybackState
      this.lastTrackId = currentTrackId || null
    } catch (error) {
    } finally {
      // Auto-Resume Logic (Issue #12)
      // Check if we need to auto-resume playback if it was paused without user interaction
      if (
        this.lastPlaybackState &&
        !this.lastPlaybackState.is_playing &&
        !playerLifecycleService.getIsManualPause() &&
        this.isInitialized &&
        this.username &&
        !this.isAutoPlayDisabled
      ) {
        // Only attempt auto-resume if device is active/ready
        // If device is not active, that's a recovery scenario handled by handleNotReady/recoveryManager
        // checking !this.lastPlaybackState.item is handled by hasTrackFinished check above
        // We only want to resume if we have an item (paused mid-track)
        if (this.lastPlaybackState.item) {
          // Double check we haven't just finished a track (which is handled separately)
          const isTrackFinished = this.hasTrackFinished(this.lastPlaybackState)
          if (!isTrackFinished) {
            try {
              // Use playerLifecycleService to resume so it can manage state (conceptually, though resumePlayback just calls spotifyPlayer)
              await playerLifecycleService.resumePlayback()
            } catch (resumeError) {}
          } else {
          }
        }
      }

      this.isPolling = false
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

    // Detailed debug logging for tracking down Issue #12 (re-playing same song)
    if (isNearEnd || isAtEnd || isStopped || (isPaused && wasPlaying)) {
    }

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

    if (finished) {
    }

    return finished
  }

  private async handleTrackFinished(
    trackId: string | undefined
  ): Promise<void> {
    if (!trackId) {
      return
    }

    // Prevent processing the same track multiple times
    if (!this.duplicateDetector.shouldProcessTrack(trackId)) {
      return
    }
    this.onTrackFinished?.(trackId)

    try {
      // Find the queue item with this Spotify track ID
      const queue = this.queueManager.getQueue()

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
              }
            } catch (refreshError) {}
          }
        } catch (error) {
          // Continue with next track even if marking as played fails
        }
      } else {
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
    } catch (error) {}
  }

  private async refreshQueueFromAPI(): Promise<number | null> {
    if (!this.username) {
      return null
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

      let response: Response
      try {
        response = await fetch(`/api/playlist/${this.username}`, {
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        return null
      }

      const queue = (await response.json()) as JukeboxQueueItem[]
      const cachedQueueLength = this.queueManager.getQueue().length

      this.queueManager.updateQueue(queue)

      return queue.length
    } catch (error) {
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
    } else if (
      freshQueueLength !== null &&
      freshQueueLength !== cachedQueueLength
    ) {
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
          }
        }

        await this.autoFillQueue()
      } catch (error) {
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
    }
  }

  private async autoFillQueue(): Promise<void> {
    if (!this.username) {
      return
    }

    // Check if we have valid track suggestions state
    if (!this.trackSuggestionsState) {
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
            excludedTrackIds = Array.from(
              new Set([...excludedTrackIds, ...tracksInCooldown])
            )
          }
        } catch (error) {
          // Non-critical: Cooldown loading failure doesn't prevent auto-fill,
          // we just won't exclude tracks in cooldown this time
        }

        let response: Response
        let errorBody: any

        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout for AI generation

          try {
            response = await fetch('/api/track-suggestions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...requestBody,
                excludedTrackIds
              }),
              signal: controller.signal
            })
          } finally {
            clearTimeout(timeoutId)
          }

          if (!response.ok) {
            const statusMessage = `REQUEST FAILED - Status: ${response.status}`
            if (this.addLog) {
              this.addLog(
                'ERROR',
                `Auto-fill request failed: ${response.status}`,
                'AutoPlayService'
              )
            }

            try {
              errorBody = await response.json()

              if (response.status === 400 && errorBody.errors) {
                // Log validation errors
                if (Array.isArray(errorBody.errors)) {
                  errorBody.errors.forEach((error: any, index: number) => {})
                }
              }
            } catch (parseError) {}

            // Handle different types of 400 errors
            if (response.status === 400) {
              if (errorBody && errorBody.errors) {
                // Validation error - log the validation errors
                throw new Error(
                  'Track suggestions validation failed. Please check your parameters.'
                )
              } else if (
                errorBody &&
                errorBody.success === false &&
                errorBody.message
              ) {
                // No suitable tracks found - log the detailed error and inform user

                if (errorBody.searchDetails) {
                  if (errorBody.searchDetails.suggestions) {
                  }
                }

                // Inform user about why no tracks were found
                const errorMessage = errorBody.message
                const suggestions = errorBody.searchDetails?.suggestions || []

                // Don't try with different parameters - just inform the user
                throw new Error(
                  `No tracks found with your current settings. ${suggestions.length > 0 ? `Suggestions: ${suggestions.join(', ')}` : ''}`
                )
              }
            }

            throw new Error('Failed to get track suggestions for auto-fill.')
          }
        } catch (fetchError) {
          const errorMessage = `FETCH ERROR: ${fetchError}`
          if (this.addLog) {
            this.addLog(
              'ERROR',
              'Network error fetching track suggestions',
              'AutoPlayService',
              fetchError instanceof Error ? fetchError : undefined
            )
          }
          throw new Error('Failed to get track suggestions for auto-fill.')
        }

        const suggestions = (await response.json()) as {
          tracks: { id: string }[]
        }

        // If no tracks were suggested, try fallback
        if (!suggestions.tracks || suggestions.tracks.length === 0) {
          throw new Error('No track suggestions available')
        }

        // Add suggested tracks to the queue
        for (const track of suggestions.tracks) {
          // Check queue size before processing each track
          const queueBeforeTrack = this.queueManager.getQueue()
          const queueSizeBeforeTrack = queueBeforeTrack.length

          if (queueSizeBeforeTrack >= targetQueueSize) {
            return
          }

          try {
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

            // Add track to queue
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
            let playlistResponse: Response

            try {
              playlistResponse = await fetch(`/api/playlist/${this.username}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tracks: trackDetails,
                  initialVotes: 1, // Auto-fill tracks get 1 vote
                  source: 'system' // Mark as system-initiated
                }),
                signal: controller.signal
              })
            } finally {
              clearTimeout(timeoutId)
            }

            if (!playlistResponse.ok) {
              const playlistError = await playlistResponse.json()

              // Handle 409 conflicts (track already in playlist) - this is not an error for auto-fill
              if (playlistResponse.status === 409) {
                continue // Skip this track and try the next one
              }
            } else {
              tracksAdded++

              // Check if we've reached the target queue size after adding this track
              const currentQueueAfterAdd = this.queueManager.getQueue()
              const currentQueueSizeAfterAdd = currentQueueAfterAdd.length

              if (currentQueueSizeAfterAdd >= targetQueueSize) {
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
              } catch (error) {
                // Non-critical: Cooldown recording failure doesn't prevent track addition,
                // we just won't track this particular track in the cooldown
              }
            }

            // Update the last suggested track cache
            try {
              // Fetch artist genres for the track
              let artistGenres: string[] = []
              try {
                if (trackDetails.artists && trackDetails.artists.length > 0) {
                  const artistId = trackDetails.artists[0].id
                  if (artistId && artistId.trim() !== '') {
                    const controller = new AbortController()
                    const timeoutId = setTimeout(() => controller.abort(), 5000)
                    try {
                      const artistResponse = await fetch(
                        `https://api.spotify.com/v1/artists/${artistId}`,
                        {
                          headers: {
                            Authorization: `Bearer ${await this.getAccessToken()}`
                          },
                          signal: controller.signal
                        }
                      )
                      if (artistResponse.ok) {
                        const artistData = await artistResponse.json()
                        artistGenres = artistData.genres || []
                      }
                    } finally {
                      clearTimeout(timeoutId)
                    }
                  }
                }
              } catch (genreError) {
                // Continue with empty genres array if fetch fails
              }

              const controller = new AbortController()
              const timeoutId = setTimeout(() => controller.abort(), 5000)
              try {
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
                  }),
                  signal: controller.signal
                })
              } finally {
                clearTimeout(timeoutId)
              }
            } catch (cacheError) {}

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

            // Show popup notification for auto-added track
            this.showAutoFillNotification(notificationMetadata)
          } catch (error) {
            const errorMessage = `Failed to add track ${track.id} to queue`
            if (this.addLog) {
              this.addLog(
                'ERROR',
                errorMessage,
                'AutoPlayService',
                error instanceof Error ? error : undefined
              )
            }
          }
        }

        // Small delay between attempts to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (error) {
        // Fallback: Get a random track from the database
        const fallbackSuccess = await this.fallbackToRandomTrack()

        if (fallbackSuccess) {
          tracksAdded++

          // Check if we've reached the target queue size after fallback
          const currentQueueAfterFallback = this.queueManager.getQueue()
          const currentQueueSizeAfterFallback = currentQueueAfterFallback.length

          if (currentQueueSizeAfterFallback >= targetQueueSize) {
            return
          }
        }

        // Small delay between fallback attempts
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      if (attempts >= maxAttempts) {
      }

      const finalQueueSize = this.queueManager.getQueue().length
    }
  }

  private async fallbackToRandomTrack(): Promise<boolean> {
    if (!this.username) {
      return false
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
        excludedTrackIds = Array.from(
          new Set([...excludedTrackIds, ...tracksInCooldown])
        )
      }
    } catch (error) {
      // Non-critical: Cooldown loading failure doesn't prevent fallback track selection,
      // we just won't exclude tracks in cooldown this time
    }

    let attempts = 0
    const maxAttempts = 5
    while (attempts < maxAttempts) {
      attempts++
      try {
        const requestBody = { username: this.username, excludedTrackIds }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        let response: Response

        try {
          response = await fetch('/api/random-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) {
          const errorBody = await response.json()
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

        if (result.success && result.track) {
          // Double-check exclusion (shouldn't be needed, but just in case)
          if (excludedTrackIds.includes(result.track.spotify_track_id)) {
            continue
          }

          // Add the random track to the queue
          const playlistController = new AbortController()
          const playlistTimeoutId = setTimeout(
            () => playlistController.abort(),
            10000
          )
          let playlistResponse: Response

          try {
            playlistResponse = await fetch(`/api/playlist/${this.username}`, {
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
              }),
              signal: playlistController.signal
            })
          } finally {
            clearTimeout(playlistTimeoutId)
          }

          if (!playlistResponse.ok) {
            const playlistError = await playlistResponse.json()
            if (playlistResponse.status === 409) {
              continue
            }
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
          } catch (error) {
            // Non-critical: Cooldown recording failure doesn't prevent track addition,
            // we just won't track this particular track in the cooldown
          }

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
          return false
        }
      } catch (error) {
        if (this.addLog) {
          this.addLog(
            'ERROR',
            'Fallback to random track failed',
            'AutoPlayService',
            error instanceof Error ? error : undefined
          )
        }
      }
    }
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
      return
    }

    // Log track transition attempt with context

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
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
        } else {
          // Fallback: Check if device is already active via alternative method
          try {
            const playbackState = await sendApiRequest<{
              device?: { id: string; is_active: boolean }
              is_playing: boolean
            }>({
              path: 'me/player',
              method: 'GET'
            })

            if (
              playbackState?.device?.id === this.deviceId &&
              playbackState.device.is_active
            ) {
              transferred = true // Treat as success since device is active
            } else {
            }
          } catch (fallbackError) {
            // Attempt playback anyway - device might be active but API is having issues
            transferred = true
          }
        }
      }
    }

    if (!transferred) {
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
        // Remove duplicate track from queue and try next track
        try {
          await this.queueManager.markAsPlayed(track.id)
        } catch (error) {}

        // Attempt to play the next track instead of returning early
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          try {
            await this.playNextTrack(nextTrack, false)
            return // Success - exit early
          } catch (error) {
            // Error recovery in catch block will handle further attempts
          }
        } else {
        }
        return
      }
    } catch (apiError) {
      // If we can't verify, log warning but continue with playback
    }

    try {
      const trackUri = buildTrackUri(track.tracks.spotify_track_id)

      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: this.deviceId,
          uris: [trackUri]
        }
      })

      // Update queue manager with currently playing track so getNextTrack() excludes it
      this.queueManager.setCurrentlyPlayingTrack(track.tracks.spotify_track_id)

      this.onNextTrackStarted?.(track)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      // Check if error is transient (network, timeout) vs permanent (restriction violated)
      const isTransientError =
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT')

      // For transient errors, attempt one retry before giving up
      if (isTransientError) {
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
          this.onNextTrackStarted?.(track)
          return // Success - exit early
        } catch (retryError) {
          // Continue with error recovery below
        }
      }

      // Error recovery: attempt to remove problematic track and try next track
      try {
        await this.queueManager.markAsPlayed(track.id)

        // Try to play the next track in queue
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          // Recursively attempt to play next track (non-predictive mode)
          await this.playNextTrack(nextTrack, false)
          // If successful, don't reset predictive state
          return
        } else {
        }
      } catch (recoveryError) {}

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
      return null
    }
  }

  private async getCurrentPlaybackState(): Promise<SpotifyPlaybackState | null> {
    return await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
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
