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
import { transferPlaybackToDevice } from '@/services/deviceManagement/deviceTransfer'
import { playbackService } from '@/services/player'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'
import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('AutoPlayService')

// How long playback may sit stopped at the end of a track before this service
// starts the next one itself. The SDK-event path normally advances within a
// second or two; this only fires when that path missed the transition.
// Longer than the 5s GET de-duplication window in sendApiRequest, so a single
// stale 'stopped' response can't trigger it on its own.
const IDLE_ADVANCE_GRACE_MS = 8000
// Minimum gap between fallback attempts (idle advance, null-state play,
// auto-resume) so a persistent failure is retried steadily, not hammered.
const RECOVERY_RETRY_MS = 15000
const AUTO_RESUME_COOLDOWN_MS = 10000

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
  private lastNullStateAttemptTime = 0
  private idleSince: number | null = null
  private lastIdleAdvanceAttemptTime = 0
  private lastAutoResumeTime = 0
  private isAutoPlayDisabled = false
  private lastSdkReactivationTime = 0
  private isInitialized = false
  private lastQueueCheckTime = 0
  private readonly QUEUE_CHECK_INTERVAL: number
  private username: string | null = null

  private readonly queueManager: QueueManager
  private readonly duplicateDetector: TrackDuplicateDetector
  private readonly poller: PlaybackPoller
  private readonly autoFiller: QueueAutoFiller
  private readonly trackPlayer: TrackPlayer
  private unsubscribeTrackRemoved: (() => void) | null = null

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

    // Any successful track removal — whether driven by this service's own REST
    // polling or by the SDK-event-driven QueueSynchronizer/playerLifecycle path —
    // should recheck queue health. Without this, auto-fill only ever runs off
    // this service's own poller, leaving no fallback if that poller ever stalls.
    this.unsubscribeTrackRemoved = this.queueManager.onTrackRemoved(() => {
      this.autoFiller.schedule(500)
    })
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
    if (this.unsubscribeTrackRemoved) {
      this.unsubscribeTrackRemoved()
      this.unsubscribeTrackRemoved = null
    }
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

    const canRecover =
      !currentState.is_playing &&
      !playerLifecycleService.getIsManualPause() &&
      this.isInitialized &&
      !!this.username &&
      !this.isAutoPlayDisabled &&
      !!this.deviceId &&
      !!currentState.item &&
      !playbackService.isOperationInProgress() &&
      !spotifyPlayerStore.getState().isTransitionInProgress

    const isStoppedAtEnd =
      canRecover && hasTrackFinished(currentState, this.lastPlaybackState)

    // Auto-resume if paused unexpectedly mid-track (Issue #12)
    if (
      canRecover &&
      !isStoppedAtEnd &&
      now - this.lastAutoResumeTime > AUTO_RESUME_COOLDOWN_MS
    ) {
      this.lastAutoResumeTime = now
      log('WARN', 'Playback paused unexpectedly mid-track — resuming')
      try {
        await playerLifecycleService.resumePlayback()
      } catch (error) {
        log(
          'WARN',
          'Auto-resume failed, will retry',
          undefined,
          error instanceof Error ? error : undefined
        )
      }
    }

    // Stalled-transition fallback: the track ended but nothing started the
    // next one (e.g. the SDK never delivered a usable end-of-track event, or
    // the play request failed). Without this the jukebox stays silent until
    // the page is reloaded.
    if (isStoppedAtEnd) {
      this.idleSince ??= now
      if (
        now - this.idleSince >= IDLE_ADVANCE_GRACE_MS &&
        now - this.lastIdleAdvanceAttemptTime >= RECOVERY_RETRY_MS
      ) {
        const finishedId = currentState.item?.id
        const nextTrack = this.queueManager
          .getQueue()
          .find((item) => item.tracks.spotify_track_id !== finishedId)
        // The REST state can lag; the SDK knows what is actually loaded. If it
        // has already moved on or is playing, the transition did happen.
        const sdkState = await playerLifecycleService
          .getPlayer()
          ?.getCurrentState()
          .catch(() => undefined)
        const sdkAdvanced =
          !!sdkState &&
          (!sdkState.paused ||
            sdkState.track_window?.current_track?.id !== finishedId)
        if (sdkAdvanced) {
          this.idleSince = null
        } else if (nextTrack) {
          this.lastIdleAdvanceAttemptTime = now
          log(
            'WARN',
            `Playback idle at end of track for ${Math.round((now - this.idleSince) / 1000)}s — starting next track "${nextTrack.tracks.name}"`
          )
          try {
            await playerLifecycleService.skipToTrack(nextTrack)
          } catch (error) {
            log(
              'WARN',
              'Idle fallback failed to start next track, will retry',
              undefined,
              error instanceof Error ? error : undefined
            )
          }
        }
      }
    } else {
      this.idleSince = null
    }

    // SDK silence watchdog: if the Spotify API says we're playing but the
    // Web Playback SDK hasn't fired a state-change event in >30 s, the browser
    // has likely suspended the audio context (e.g. tab backgrounded on macOS
    // Chrome).  Transferring playback back to our device wakes up the SDK.
    if (
      currentState.is_playing &&
      !playerLifecycleService.getIsManualPause() &&
      this.isInitialized &&
      this.deviceId
    ) {
      const lastSDKUpdate = playerLifecycleService.getLastSDKStateUpdateTime()
      const sdkSilentMs = lastSDKUpdate > 0 ? Date.now() - lastSDKUpdate : 0
      const reactivationCooldown = 30000
      if (
        sdkSilentMs > 30000 &&
        Date.now() - this.lastSdkReactivationTime > reactivationCooldown
      ) {
        this.lastSdkReactivationTime = Date.now()

        // The SDK doesn't fire events during steady-state play — silence alone
        // doesn't mean audio stopped. Query the SDK directly: if it reports
        // paused=false the device is healthy and we must not disturb it
        // (transferring with play:true causes an audible stutter every 30 s).
        // Only transfer when the SDK confirms it is genuinely paused or gone.
        const sdkState = await playerLifecycleService
          .getPlayer()
          ?.getCurrentState()
          .catch(() => undefined)

        if (sdkState !== null && sdkState !== undefined && !sdkState.paused) {
          return
        }

        void transferPlaybackToDevice(this.deviceId, 1, 500, true, true).catch(
          () => {}
        )
      }
    }
  }

  private async handleNullState(): Promise<void> {
    if (!this.isInitialized || !this.username || this.isAutoPlayDisabled) return

    const nextTrack = this.queueManager.getNextTrack()
    if (!nextTrack) return

    // Retry the same track periodically rather than only once: if the first
    // attempt failed (device still waking up, network blip) a one-shot guard
    // would leave playback stopped for good.
    const now = Date.now()
    const isNewTrack =
      nextTrack.tracks.spotify_track_id !== this.lastNullStateAttemptTrackId
    if (
      !isNewTrack &&
      now - this.lastNullStateAttemptTime < RECOVERY_RETRY_MS
    ) {
      return
    }
    if (playbackService.isOperationInProgress()) return

    this.lastNullStateAttemptTrackId = nextTrack.tracks.spotify_track_id
    this.lastNullStateAttemptTime = now
    try {
      await playerLifecycleService.skipToTrack(nextTrack)
    } catch (error) {
      log(
        'WARN',
        'No active playback — failed to start next track, will retry',
        undefined,
        error instanceof Error ? error : undefined
      )
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
