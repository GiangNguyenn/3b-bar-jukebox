import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { sendApiRequest } from '@/shared/api'
import { QueueManager } from './queueManager'
import { createModuleLogger } from '@/shared/utils/logger'

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
      `[AutoPlayService] Configuration - checkInterval: ${this.checkInterval}, username: ${this.username}, deviceId: ${this.deviceId}`
    )

    this.intervalRef = setInterval(() => {
      void this.checkPlaybackState()
    }, this.checkInterval)

    logger('INFO', '[AutoPlayService] Auto-play service started successfully')
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
    logger('INFO', `[AutoPlayService] Setting username: ${username}`)
    this.username = username
    logger('INFO', `[AutoPlayService] Updated username: ${this.username}`)
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    logger(
      'INFO',
      `[AutoPlayService] Updating queue with ${queue.length} tracks`
    )
    this.queueManager.updateQueue(queue)
    logger(
      'INFO',
      `[AutoPlayService] Updated queue with ${queue.length} tracks`
    )
  }

  public setTrackSuggestionsState(state: any): void {
    this.trackSuggestionsState = state
    logger(
      'INFO',
      `[AutoPlayService] Updated track suggestions state: ${JSON.stringify(state)}`
    )
  }

  public disableAutoPlay(): void {
    this.isAutoPlayDisabled = true
    logger('INFO', '[AutoPlayService] Auto-play temporarily disabled')
  }

  public enableAutoPlay(): void {
    this.isAutoPlayDisabled = false
    logger('INFO', '[AutoPlayService] Auto-play re-enabled')
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
      logger(
        'INFO',
        `[checkPlaybackState] Current state - trackId: ${currentTrackId}, isPlaying: ${isPlaying}, progress: ${progress}, duration: ${duration}`
      )

      // Add more detailed logging for track finished detection
      const hasFinished = this.hasTrackFinished(currentState)
      logger(
        'INFO',
        `[checkPlaybackState] Track finished detection: ${hasFinished}`
      )

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
      logger('INFO', '[hasTrackFinished] No last state or current item')
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

    logger(
      'INFO',
      `[hasTrackFinished] Conditions - isAtEnd: ${isAtEnd}, isNearEnd: ${isNearEnd}, isSameTrack: ${isSameTrack}, wasPlaying: ${wasPlaying}, isPaused: ${isPaused}, isStopped: ${isStopped}, hasProgressed: ${hasProgressed}, hasStalled: ${hasStalled}`
    )

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

    logger('INFO', `[hasTrackFinished] Track finished: ${finished}`)
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

    logger(
      'INFO',
      `[checkAndAutoFillQueue] Checking queue - length: ${queue.length}, isAutoFilling: ${this.isAutoFilling}, username: ${this.username}`
    )
    logger(
      'INFO',
      `[checkAndAutoFillQueue] Queue details: ${JSON.stringify(queue.map((item) => ({ id: item.id, name: item.tracks.name })))}`
    )

    // Check if queue is low (3 or fewer tracks remaining)
    if (
      queue.length < this.autoFillTargetSize &&
      !this.isAutoFilling &&
      this.username
    ) {
      logger(
        'INFO',
        `[checkAndAutoFillQueue] Queue is below target (${queue.length}/${this.autoFillTargetSize} tracks), triggering auto-fill`
      )
      this.onQueueLow?.()

      try {
        this.isAutoFilling = true
        logger('INFO', '[checkAndAutoFillQueue] Starting auto-fill process')
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
    } else {
      logger(
        'INFO',
        `[checkAndAutoFillQueue] Queue check conditions not met - length: ${queue.length}, isAutoFilling: ${this.isAutoFilling}, username: ${this.username}`
      )
    }
  }

  private async autoFillQueue(): Promise<void> {
    if (!this.username) {
      logger('ERROR', 'No username available for auto-fill')
      return
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
        // Use user's track suggestions configuration for auto-fill
        const requestBody = this.trackSuggestionsState || {
          genres: ['Rock', 'Pop', 'Hip Hop', 'Electronic'], // Fallback genres if no user config
          yearRange: [1980, new Date().getFullYear()], // Fallback year range
          popularity: 30, // Fallback popularity threshold
          allowExplicit: true, // Fallback explicit content setting
          maxSongLength: 8, // Fallback max song length
          songsBetweenRepeats: 20, // Fallback songs between repeats
          maxOffset: 50 // Fallback max offset
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
          `[AutoFill] Attempt ${attempts} - User track suggestions config: ${JSON.stringify(this.trackSuggestionsState)}`
        )

        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Sending track suggestions request: ${JSON.stringify(requestBody)}`
        )

        const response = await fetch('/api/track-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...requestBody,
            excludedTrackIds // Add excluded track IDs to prevent duplicates
          })
        })

        logger(
          'INFO',
          `[AutoFill] Attempt ${attempts} - Track suggestions response status: ${response.status}`
        )

        if (!response.ok) {
          const errorBody = await response.json()
          logger(
            'ERROR',
            `[AutoFill] Attempt ${attempts} - Track Suggestions API error: ${JSON.stringify(errorBody)}`
          )

          // If it's a validation error, try with fallback parameters
          if (response.status === 400 && errorBody.errors) {
            logger(
              'WARN',
              `[AutoFill] Attempt ${attempts} - Validation error, trying with fallback parameters`
            )

            // Try with fallback parameters
            const fallbackRequestBody = {
              genres: ['Rock', 'Pop', 'Hip Hop', 'Electronic'],
              yearRange: [1980, new Date().getFullYear()],
              popularity: 30,
              allowExplicit: true,
              maxSongLength: 8,
              songsBetweenRepeats: 20,
              maxOffset: 50,
              excludedTrackIds: excludedTrackIds
            }

            const fallbackResponse = await fetch('/api/track-suggestions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fallbackRequestBody)
            })

            if (!fallbackResponse.ok) {
              const fallbackErrorBody = await fallbackResponse.json()
              logger(
                'ERROR',
                `[AutoFill] Attempt ${attempts} - Fallback Track Suggestions API also failed: ${JSON.stringify(fallbackErrorBody)}`
              )
              throw new Error(
                'Failed to get track suggestions for auto-fill (both user config and fallback failed).'
              )
            }

            // Use fallback response
            const fallbackSuggestions = (await fallbackResponse.json()) as {
              tracks: { id: string }[]
            }

            if (
              !fallbackSuggestions.tracks ||
              fallbackSuggestions.tracks.length === 0
            ) {
              throw new Error('No track suggestions available from fallback.')
            }

            // Process fallback suggestions
            for (const track of fallbackSuggestions.tracks) {
              try {
                logger(
                  'INFO',
                  `[AutoFill] Attempt ${attempts} - Fetching full details for fallback track: ${track.id}`
                )

                const trackDetails = await sendApiRequest<{
                  id: string
                  name: string
                  artists: Array<{ name: string }>
                  album: { name: string }
                  duration_ms: number
                  popularity: number
                  uri: string
                }>({
                  path: `tracks/${track.id}`,
                  method: 'GET'
                })

                const playlistResponse = await fetch(
                  `/api/playlist/${this.username}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      tracks: trackDetails,
                      initialVotes: 1,
                      source: 'system'
                    })
                  }
                )

                if (!playlistResponse.ok) {
                  const playlistError = await playlistResponse.json()

                  if (playlistResponse.status === 409) {
                    logger(
                      'INFO',
                      `[AutoFill] Attempt ${attempts} - Fallback track already in playlist: ${trackDetails.name}, skipping`
                    )
                    continue
                  }

                  logger(
                    'ERROR',
                    `[AutoFill] Attempt ${attempts} - Failed to add fallback track to playlist: ${JSON.stringify(playlistError)}`
                  )
                } else {
                  tracksAdded++
                  logger(
                    'INFO',
                    `[AutoFill] Attempt ${attempts} - Successfully added fallback track to queue: ${trackDetails.name} (Total added: ${tracksAdded})`
                  )
                }

                this.showAutoFillNotification(
                  trackDetails.name,
                  trackDetails.artists[0]?.name || 'Unknown Artist'
                )
              } catch (error) {
                logger(
                  'ERROR',
                  `[AutoFill] Attempt ${attempts} - Failed to add fallback track ${track.id} to queue`,
                  undefined,
                  error as Error
                )
              }
            }

            // Continue to next attempt
            await new Promise((resolve) => setTimeout(resolve, 1000))
            continue
          }

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
              artists: Array<{ name: string }>
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
    }

    if (attempts >= maxAttempts) {
      logger(
        'WARN',
        `[AutoFill] Reached maximum attempts (${maxAttempts}), stopping auto-fill process`
      )
    }

    const finalQueueSize = this.queueManager.getQueue().length
    logger(
      'INFO',
      `[AutoFill] Auto-fill process completed - Final queue size: ${finalQueueSize}, Tracks added this session: ${tracksAdded}, Total attempts: ${attempts}`
    )
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

        logger(
          'INFO',
          `[Fallback] Random track response status: ${response.status}`
        )

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
            logger(
              'INFO',
              `[Fallback] Successfully added random track to queue: ${result.track.name}`
            )
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
    queueLength: number
  } {
    return {
      isRunning: this.isRunning,
      deviceId: this.deviceId,
      username: this.username,
      isAutoPlayDisabled: this.isAutoPlayDisabled,
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
