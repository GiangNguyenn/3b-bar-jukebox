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
  DEFAULT_SONGS_BETWEEN_REPEATS,
  DEFAULT_MAX_OFFSET
} from '@/shared/constants/trackSuggestion'

const logger = createModuleLogger('AutoPlayService')

interface AutoPlayServiceConfig {
  checkInterval?: number // How often to check playback state (default: 5 seconds)
  deviceId?: string | null
  onTrackFinished?: (trackId: string) => void
  onNextTrackStarted?: (track: JukeboxQueueItem) => void
  onQueueEmpty?: () => void
  onQueueLow?: () => void // New callback for when queue is low
  username?: string | null // Username for auto-fill operations
  autoFillTargetSize?: number // Target number of tracks for auto-fill (default: 3)
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
  private lastProcessedTrackId: string | null = null // Prevent processing the same track multiple times
  private autoFillTargetSize: number
  private autoFillMaxAttempts: number
  private trackSuggestionsState: any = null // User's track suggestions configuration
  private isAutoPlayDisabled: boolean = false // Flag to temporarily disable auto-play during manual operations
  private isInitialized: boolean = false // Flag to track if the service is properly initialized

  constructor(config: AutoPlayServiceConfig = {}) {
    this.checkInterval = config.checkInterval || 1000 // Reduced from 2000ms to 1000ms for faster detection
    this.deviceId = config.deviceId || null
    this.onTrackFinished = config.onTrackFinished
    this.onNextTrackStarted = config.onNextTrackStarted
    this.onQueueEmpty = config.onQueueEmpty
    this.onQueueLow = config.onQueueLow
    this.username = config.username || null
    this.autoFillTargetSize = config.autoFillTargetSize || 3
    this.autoFillMaxAttempts = config.autoFillMaxAttempts || 20
    this.queueManager = QueueManager.getInstance()
  }

  public start(): void {
    if (this.isRunning) {
      logger('WARN', 'Auto-play service is already running')
      return
    }

    this.isRunning = true
    logger('INFO', 'Starting auto-play service')
    logger(
      'INFO',
      `Configuration - checkInterval: ${this.checkInterval}, username: ${this.username}, deviceId: ${this.deviceId}`
    )

    this.intervalRef = setInterval(() => {
      void this.checkPlaybackState()
    }, this.checkInterval)

    logger('INFO', 'Auto-play service started successfully')
  }

  public stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    logger('INFO', 'Stopping auto-play service')

    if (this.intervalRef) {
      clearInterval(this.intervalRef)
      this.intervalRef = null
    }
  }

  public setDeviceId(deviceId: string | null): void {
    this.deviceId = deviceId
    logger('INFO', `Updated device ID: ${deviceId}`)
  }

  public setUsername(username: string | null): void {
    logger('INFO', `Setting username: ${username}`)
    this.username = username
    logger('INFO', `Updated username: ${this.username}`)
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    logger('INFO', `Updating queue with ${queue.length} tracks`)
    this.queueManager.updateQueue(queue)
    logger('INFO', `Updated queue with ${queue.length} tracks`)
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
    logger('INFO', 'Auto-play temporarily disabled')
  }

  public enableAutoPlay(): void {
    this.isAutoPlayDisabled = false
    logger('INFO', 'Auto-play re-enabled')
  }

  public markAsInitialized(): void {
    this.isInitialized = true
    logger('INFO', 'Service marked as initialized')
  }

  private async checkPlaybackState(): Promise<void> {
    try {
      const currentState = await this.getCurrentPlaybackState()

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

      // Add more detailed logging for track finished detection
      const hasFinished = this.hasTrackFinished(currentState)

      // Reset lastProcessedTrackId if we're playing a different track
      if (currentTrackId && currentTrackId !== this.lastTrackId) {
        this.lastProcessedTrackId = null
        logger(
          'INFO',
          `New track detected: ${currentTrackId}, resetting processed track ID`
        )
      }

      // Check if track has finished
      if (this.hasTrackFinished(currentState)) {
        logger('INFO', `Track finished detected for: ${currentTrackId}`)
        try {
          logger(
            'INFO',
            '[checkPlaybackState] About to call handleTrackFinished'
          )
          await this.handleTrackFinished(currentTrackId)
          logger(
            'INFO',
            '[checkPlaybackState] handleTrackFinished completed successfully'
          )
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
    const isAtEnd = duration > 0 && duration - progress < 1000 // Reduced from 3000ms to 1000ms for faster detection
    const isSameTrack = currentTrackId === lastTrackId
    const wasPlaying = lastState.is_playing
    const isPaused = !currentState.is_playing
    const isStopped = !currentState.is_playing && progress === 0 // Track stopped and reset to beginning
    const hasProgressed = progress > (lastState.progress_ms || 0) // Track has progressed since last check
    const isNearEnd = duration > 0 && duration - progress < 500 // Very near end (500ms)
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
    if (this.lastProcessedTrackId === trackId) {
      logger('INFO', `Track ${trackId} already processed, skipping`)
      return
    }

    logger('INFO', `Track finished: ${trackId}`)
    this.lastProcessedTrackId = trackId
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

      if (!queueItem) {
        logger('ERROR', `No queue item found for finished trackId: ${trackId}`)
        return
      }

      // Mark the track as played in the queue using the queue item's UUID
      await this.queueManager.markAsPlayed(queueItem.id)
      logger('INFO', `Marked queue item ${queueItem.id} as played`)

      // Check if queue is getting low and trigger auto-fill if needed
      logger('INFO', '[handleTrackFinished] Calling checkAndAutoFillQueue...')
      await this.checkAndAutoFillQueue()
      logger('INFO', '[handleTrackFinished] checkAndAutoFillQueue completed')

      // Get the next track from the queue
      const nextTrack = this.queueManager.getNextTrack()

      if (nextTrack) {
        // Check if auto-play is disabled (e.g., during manual refresh)
        if (this.isAutoPlayDisabled) {
          logger(
            'INFO',
            '[handleTrackFinished] Auto-play is disabled, skipping automatic playback'
          )
          return
        }

        await this.playNextTrack(nextTrack)
      } else {
        logger('INFO', 'Queue is empty, stopping playback')
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

  private async checkAndAutoFillQueue(): Promise<void> {
    const queue = this.queueManager.getQueue()

    // Check if queue is low (3 or fewer tracks remaining)
    if (
      queue.length < this.autoFillTargetSize &&
      !this.isAutoFilling &&
      this.username &&
      this.isInitialized
    ) {
      // Additional check to ensure we have valid track suggestions state or fallback defaults
      const hasValidState = this.trackSuggestionsState || true // Always allow auto-fill with fallbacks
      logger(
        'INFO',
        `[checkAndAutoFillQueue] Triggering auto-fill - queue: ${queue.length}/${this.autoFillTargetSize} tracks`
      )
      this.onQueueLow?.()

      try {
        this.isAutoFilling = true
        logger('INFO', '[checkAndAutoFillQueue] Starting auto-fill process')

        // Small delay to ensure track suggestions state is properly loaded
        if (!this.trackSuggestionsState) {
          logger(
            'INFO',
            '[checkAndAutoFillQueue] No track suggestions state, waiting 1 second for initialization'
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else {
          // Validate that track suggestions state has required fields
          const requiredFields = [
            'genres',
            'yearRange',
            'popularity',
            'allowExplicit',
            'maxSongLength',
            'songsBetweenRepeats',
            'maxOffset'
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
          } else {
            logger(
              'INFO',
              `[checkAndAutoFillQueue] Track suggestions state has all required fields`
            )
          }
        }

        await this.autoFillQueue()
        logger('INFO', '[checkAndAutoFillQueue] Auto-fill process completed')
      } catch (error) {
        logger(
          'ERROR',
          '[checkAndAutoFillQueue] Failed to auto-fill queue',
          undefined,
          error as Error
        )
      } finally {
        this.isAutoFilling = false
        logger(
          'INFO',
          '[checkAndAutoFillQueue] Auto-fill process finished, resetting isAutoFilling flag'
        )
      }
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
    } else {
      logger(
        'INFO',
        `[AutoFill] Track suggestions state available: ${JSON.stringify(this.trackSuggestionsState)}`
      )
      logger(
        'INFO',
        `[AutoFill] Track suggestions state type: ${typeof this.trackSuggestionsState}`
      )
      logger(
        'INFO',
        `[AutoFill] Track suggestions state keys: ${Object.keys(this.trackSuggestionsState).join(', ')}`
      )
    }

    logger('INFO', '[AutoFill] Starting auto-fill process')

    const targetQueueSize = this.autoFillTargetSize // Target number of tracks in queue
    const maxAttempts = this.autoFillMaxAttempts // Maximum attempts to prevent infinite loops
    let attempts = 0
    let tracksAdded = 0

    while (attempts < maxAttempts) {
      attempts++

      // Check current queue size
      const currentQueue = this.queueManager.getQueue()
      const currentQueueSize = currentQueue.length

      logger(
        'INFO',
        `[AutoFill] Attempt ${attempts}/${maxAttempts} - Current queue size: ${currentQueueSize}, Target: ${targetQueueSize}, Tracks added this session: ${tracksAdded}`
      )

      // If we've reached the target, stop
      if (currentQueueSize >= targetQueueSize) {
        logger(
          'INFO',
          `[AutoFill] Target queue size reached (${currentQueueSize}/${targetQueueSize}), stopping auto-fill`
        )
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
          songsBetweenRepeats: Math.max(
            2,
            Math.min(
              100,
              Math.floor(
                this.trackSuggestionsState?.songsBetweenRepeats ??
                  DEFAULT_SONGS_BETWEEN_REPEATS
              )
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
          'songsBetweenRepeats',
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
        const excludedTrackIds = currentQueue.map(
          (item) => item.tracks.spotify_track_id
        )

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
              songsBetweenRepeats: typeof requestBody.songsBetweenRepeats,
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
              album: { name: string }
              duration_ms: number
              popularity: number
              uri: string
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

            // Show popup notification for auto-added track
            this.showAutoFillNotification(
              trackDetails.name,
              trackDetails.artists[0]?.name || 'Unknown Artist'
            )
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
    const excludedTrackIds = currentQueue.map(
      (item) => item.tracks.spotify_track_id
    )

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

          // Show popup notification for fallback track
          this.showAutoFillNotification(
            result.track.name,
            result.track.artist,
            true
          )
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

  private showAutoFillNotification(
    trackName: string,
    artistName: string,
    isFallback = false
  ): void {
    // Only dispatch events on the client side
    if (typeof window !== 'undefined') {
      // Create a custom event to trigger the notification
      const event = new CustomEvent('autoFillNotification', {
        detail: {
          trackName,
          artistName,
          isFallback,
          timestamp: Date.now()
        }
      })

      // Dispatch the event on the window object
      window.dispatchEvent(event)
    }
  }

  private async playNextTrack(track: JukeboxQueueItem): Promise<void> {
    if (!this.deviceId) {
      logger('ERROR', 'No device ID available to play next track')
      return
    }

    try {
      const trackUri = `spotify:track:${track.tracks.spotify_track_id}`

      logger('INFO', `Playing next track: ${track.tracks.name} (${trackUri})`)

      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: this.deviceId,
          uris: [trackUri]
        }
      })

      this.onNextTrackStarted?.(track)
      logger('INFO', `Successfully started playing: ${track.tracks.name}`)
    } catch (error) {
      logger('ERROR', 'Failed to play next track', undefined, error as Error)
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
