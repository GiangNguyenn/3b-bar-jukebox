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
    this.username = username
    logger('INFO', `Updated username: ${username}`)
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    this.queueManager.updateQueue(queue)
    logger('INFO', `Updated queue with ${queue.length} tracks`)
  }

  private async checkPlaybackState(): Promise<void> {
    try {
      const currentState = await this.getCurrentPlaybackState()

      if (!currentState) {
        return
      }

      const currentTrackId = currentState.item?.id
      const isPlaying = currentState.is_playing
      const progress = currentState.progress_ms || 0
      const duration = currentState.item?.duration_ms || 0

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
        await this.handleTrackFinished(currentTrackId)
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
      await this.checkAndAutoFillQueue()

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

    // Check if queue is low (3 or fewer tracks remaining)
    if (queue.length <= 3 && !this.isAutoFilling && this.username) {
      logger(
        'INFO',
        `Queue is low (${queue.length} tracks remaining), triggering auto-fill`
      )
      this.onQueueLow?.()

      try {
        this.isAutoFilling = true
        await this.autoFillQueue()
      } catch (error) {
        logger('ERROR', 'Failed to auto-fill queue', undefined, error as Error)
      } finally {
        this.isAutoFilling = false
      }
    }
  }

  private async autoFillQueue(): Promise<void> {
    if (!this.username) {
      logger('ERROR', 'No username available for auto-fill')
      return
    }

    logger('INFO', 'Starting automatic queue auto-fill')

    try {
      // Get track suggestions
      const response = await fetch('/api/track-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}) // Use default parameters for auto-fill
      })

      if (!response.ok) {
        const errorBody = await response.json()
        logger(
          'ERROR',
          `Track Suggestions API error: ${JSON.stringify(errorBody)}`
        )
        throw new Error('Failed to get track suggestions for auto-fill.')
      }

      const suggestions = (await response.json()) as {
        tracks: { id: string }[]
      }

      logger(
        'INFO',
        `Got ${suggestions.tracks.length} track suggestions for auto-fill`
      )

      // Add suggested tracks to the queue
      for (const track of suggestions.tracks) {
        try {
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

          // Add track to queue
          await fetch(`/api/playlist/${this.username}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracks: trackDetails,
              initialVotes: 1 // Auto-fill tracks get 1 vote
            })
          })

          logger('INFO', `Added track to queue: ${trackDetails.name}`)
        } catch (error) {
          logger(
            'ERROR',
            `Failed to add track ${track.id} to queue`,
            undefined,
            error as Error
          )
        }
      }

      logger('INFO', 'Automatic queue auto-fill completed successfully')
    } catch (error) {
      logger('ERROR', 'Auto-fill failed', undefined, error as Error)
      throw error
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
