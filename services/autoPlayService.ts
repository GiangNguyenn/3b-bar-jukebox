import { JukeboxQueueItem } from '@/shared/types/queue'
import { QueueManager } from './queueManager'
import { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { PlaybackPoller } from './autoPlay/PlaybackPoller'
import { hasTrackFinished } from './autoPlay/TrackFinishDetector'
import { QueueAutoFiller } from './autoPlay/QueueAutoFiller'
import { TrackPlayer } from './autoPlay/TrackPlayer'

interface AutoPlayServiceConfig {
  checkInterval?: number
  deviceId?: string | null
  onTrackFinished?: (trackId: string) => void
  onNextTrackStarted?: (track: JukeboxQueueItem) => void
  onQueueEmpty?: () => void
  onQueueLow?: () => void
  username?: string | null
  autoFillTargetSize?: number
  autoFillMaxAttempts?: number
  queueCheckInterval?: number
}

export class AutoPlayService {
  private isRunning = false
  private deviceId: string | null = null
  private lastPlaybackState: SpotifyPlaybackState | null = null
  private lastTrackId: string | null = null
  private lastNullStateAttemptTrackId: string | null = null
  private isAutoPlayDisabled = false
  private isInitialized = false
  private lastQueueCheckTime = 0
  private readonly QUEUE_CHECK_INTERVAL: number
  private username: string | null = null

  private readonly queueManager: QueueManager
  private readonly duplicateDetector: TrackDuplicateDetector
  private readonly poller: PlaybackPoller
  private readonly autoFiller: QueueAutoFiller
  private readonly trackPlayer: TrackPlayer

  private onTrackFinished?: (trackId: string) => void
  private onQueueEmpty?: () => void

  constructor(config: AutoPlayServiceConfig = {}) {
    this.username = config.username ?? null
    this.deviceId = config.deviceId ?? null
    this.QUEUE_CHECK_INTERVAL = config.queueCheckInterval ?? 10000
    this.onTrackFinished = config.onTrackFinished
    this.onQueueEmpty = config.onQueueEmpty

    this.queueManager = QueueManager.getInstance()
    this.duplicateDetector = new TrackDuplicateDetector()

    this.autoFiller = new QueueAutoFiller(this.queueManager, {
      autoFillTargetSize: config.autoFillTargetSize,
      autoFillMaxAttempts: config.autoFillMaxAttempts,
      onQueueLow: config.onQueueLow
    })
    this.autoFiller.setUsername(this.username)

    this.trackPlayer = new TrackPlayer(this.queueManager, {
      deviceId: this.deviceId,
      onNextTrackStarted: config.onNextTrackStarted
    })

    this.poller = new PlaybackPoller(
      {
        onState: (state) => this.handleState(state),
        onNullState: () => this.handleNullState()
      },
      config.checkInterval
    )
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.poller.start()
  }

  public stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    this.poller.stop()
  }

  // ─── Configuration setters ────────────────────────────────────────────────

  public setDeviceId(deviceId: string | null): void {
    if (this.deviceId !== deviceId) {
      this.deviceId = deviceId
      this.trackPlayer.setDeviceId(deviceId)
    }
  }

  public setUsername(username: string | null): void {
    this.username = username
    this.autoFiller.setUsername(username)
  }

  public setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ): void {
    this.autoFiller.setLogger(logger)
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    this.queueManager.updateQueue(queue)
  }

  public setActivePrompt(prompt: string): void {
    this.autoFiller.setActivePrompt(prompt)
  }

  public setAutoFillTargetSize(targetSize: number): void {
    this.autoFiller.setAutoFillTargetSize(targetSize)
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

  // ─── Status / accessors ───────────────────────────────────────────────────

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
    return null
  }

  public resetAfterSeek(): void {
    this.lastPlaybackState = null
    this.lastTrackId = null
    if (this.isRunning) {
      this.poller.triggerPoll()
    }
  }

  // ─── Playback state handlers (wired to PlaybackPoller) ────────────────────

  private async handleState(currentState: SpotifyPlaybackState): Promise<void> {
    // Throttled queue check
    const now = Date.now()
    if (
      this.isInitialized &&
      this.username &&
      now - this.lastQueueCheckTime > this.QUEUE_CHECK_INTERVAL
    ) {
      this.lastQueueCheckTime = now
      this.autoFiller.schedule(0)
    }

    const currentTrackId = currentState.item?.id

    // Clear null-state guard when a different track is playing
    if (currentTrackId && currentTrackId !== this.lastNullStateAttemptTrackId) {
      this.lastNullStateAttemptTrackId = null
    }

    // Reset duplicate detector on track change (manual skip detection)
    if (currentTrackId && currentTrackId !== this.lastTrackId) {
      this.duplicateDetector.setLastKnownPlayingTrack(currentTrackId)
    }

    // Detect track finish and handle transition
    if (
      this.lastPlaybackState &&
      hasTrackFinished(currentState, this.lastPlaybackState)
    ) {
      try {
        await this.handleTrackFinished(currentTrackId)
      } catch {}
    }

    // Dynamically adjust poll frequency
    this.poller.adjustInterval(currentState)

    // Store minimal state to avoid accumulating image URLs etc.
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
    this.lastTrackId = currentTrackId ?? null

    // Auto-resume if paused unexpectedly mid-track (Issue #12)
    if (
      !currentState.is_playing &&
      !playerLifecycleService.getIsManualPause() &&
      this.isInitialized &&
      this.username &&
      !this.isAutoPlayDisabled &&
      currentState.item
    ) {
      const isFinished = hasTrackFinished(currentState, this.lastPlaybackState)
      if (!isFinished) {
        try {
          await playerLifecycleService.resumePlayback()
        } catch {}
      }
    }
  }

  private async handleNullState(): Promise<void> {
    if (!this.isInitialized || !this.username || this.isAutoPlayDisabled) return

    const nextTrack = this.queueManager.getNextTrack()
    if (
      nextTrack &&
      nextTrack.tracks.spotify_track_id !== this.lastNullStateAttemptTrackId
    ) {
      this.lastNullStateAttemptTrackId = nextTrack.tracks.spotify_track_id
      try {
        await playerLifecycleService.skipToTrack(nextTrack)
      } catch {}
    }
  }

  private async handleTrackFinished(
    trackId: string | undefined
  ): Promise<void> {
    if (!trackId) return
    if (!this.duplicateDetector.shouldProcessTrack(trackId)) return

    this.onTrackFinished?.(trackId)

    try {
      const queueItem = this.queueManager
        .getQueue()
        .find((item) => item.tracks.spotify_track_id === trackId)

      if (queueItem) {
        try {
          await this.queueManager.markAsPlayed(queueItem.id)
          // Small delay to let the DELETE propagate before refreshing
          await new Promise<void>((resolve) => setTimeout(resolve, 200))
          if (this.username) {
            await this.autoFiller.refreshQueue()
          }
        } catch {}
      }

      this.autoFiller.schedule(500)

      if (!this.queueManager.getQueue()[0]) {
        this.onQueueEmpty?.()
      }
    } catch {}
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

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
