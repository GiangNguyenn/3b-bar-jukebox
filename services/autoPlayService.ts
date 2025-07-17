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

  constructor(config: AutoPlayServiceConfig = {}) {
    this.checkInterval = config.checkInterval || 5000
    this.deviceId = config.deviceId || null
    this.onTrackFinished = config.onTrackFinished
    this.onNextTrackStarted = config.onNextTrackStarted
    this.onQueueEmpty = config.onQueueEmpty
    this.onQueueLow = config.onQueueLow
    this.username = config.username || null
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

    // More robust detection - check multiple conditions
    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const isAtEnd = duration > 0 && duration - progress < 2000 // Within 2 seconds of end
    const isSameTrack = currentTrackId === lastTrackId
    const wasPlaying = lastState.is_playing
    const isPaused = !currentState.is_playing
    const isStopped = !currentState.is_playing && progress === 0 // Track stopped and reset to beginning

    // Track finished if:
    // 1. We were playing, now paused/stopped, same track, near end
    // 2. Track stopped and reset to beginning (natural end)
    const finished =
      (wasPlaying && (isPaused || isStopped) && isSameTrack && isAtEnd) ||
      (isStopped && isSameTrack)

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
    if (queue.length <= 3 && !this.isAutoFilling && this.username) {
      logger(
        'INFO',
        `[checkAndAutoFillQueue] Queue is low (${queue.length} tracks remaining), triggering auto-fill`
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

    try {
      // Get track suggestions with default parameters for auto-fill
      const requestBody = {
        genres: ['Rock', 'Pop', 'Hip Hop'], // Default genres for auto-fill
        yearRange: [1950, new Date().getFullYear()], // Default year range
        popularity: 50, // Default minimum popularity
        allowExplicit: false, // Default to no explicit content
        maxSongLength: 5, // Default max song length in minutes
        songsBetweenRepeats: 50, // Default songs between repeats
        maxOffset: 10 // Default max offset
      }

      logger(
        'INFO',
        `[AutoFill] Sending track suggestions request: ${JSON.stringify(requestBody)}`
      )

      const response = await fetch('/api/track-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      logger(
        'INFO',
        `[AutoFill] Track suggestions response status: ${response.status}`
      )

      if (!response.ok) {
        const errorBody = await response.json()
        logger(
          'ERROR',
          `[AutoFill] Track Suggestions API error: ${JSON.stringify(errorBody)}`
        )
        throw new Error('Failed to get track suggestions for auto-fill.')
      }

      const suggestions = (await response.json()) as {
        tracks: { id: string }[]
      }

      logger(
        'INFO',
        `[AutoFill] Track suggestions response: ${JSON.stringify(suggestions)}`
      )

      // If no tracks were suggested, trigger fallback
      if (!suggestions.tracks || suggestions.tracks.length === 0) {
        logger(
          'WARN',
          '[AutoFill] No track suggestions received, triggering fallback'
        )
        throw new Error('No track suggestions available')
      }

      // Add suggested tracks to the queue
      for (const track of suggestions.tracks) {
        try {
          logger(
            'INFO',
            `[AutoFill] Fetching full details for track: ${track.id}`
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
            `[AutoFill] Track details: ${JSON.stringify({
              name: trackDetails.name,
              artist: trackDetails.artists[0]?.name,
              duration_ms: trackDetails.duration_ms,
              popularity: trackDetails.popularity
            })}`
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
            logger(
              'ERROR',
              `[AutoFill] Failed to add track to playlist: ${JSON.stringify(playlistError)}`
            )
          } else {
            logger(
              'INFO',
              `[AutoFill] Successfully added track to queue: ${trackDetails.name}`
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
            `[AutoFill] Failed to add track ${track.id} to queue`,
            undefined,
            error as Error
          )
        }
      }
    } catch (error) {
      logger(
        'ERROR',
        '[AutoFill] Auto-fill failed, trying fallback random track',
        undefined,
        error as Error
      )
      logger(
        'INFO',
        `[AutoFill] Error details: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      // Fallback: Get a random track from the database
      logger('INFO', '[AutoFill] Calling fallbackToRandomTrack...')
      await this.fallbackToRandomTrack()
      logger('INFO', '[AutoFill] FallbackToRandomTrack completed')
    }
  }

  private async fallbackToRandomTrack(): Promise<void> {
    if (!this.username) {
      logger('ERROR', '[Fallback] No username available for fallback')
      return
    }

    logger(
      'INFO',
      `[Fallback] Starting fallback to random track for username: ${this.username}`
    )

    try {
      const requestBody = { username: this.username }
      logger(
        'INFO',
        `[Fallback] Sending random track request: ${JSON.stringify(requestBody)}`
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
        logger(
          'INFO',
          `[Fallback] Adding random track to queue: ${result.track.name} by ${result.track.artist}`
        )

        // Add the random track to the queue
        const playlistResponse = await fetch(`/api/playlist/${this.username}`, {
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
        })

        if (!playlistResponse.ok) {
          const playlistError = await playlistResponse.json()
          logger(
            'ERROR',
            `[Fallback] Failed to add random track to playlist: ${JSON.stringify(playlistError)}`
          )
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
      } else {
        logger('ERROR', '[Fallback] No random track available for fallback')
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
