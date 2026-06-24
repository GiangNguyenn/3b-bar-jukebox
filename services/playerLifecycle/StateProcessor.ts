import type {} from 'scheduler-polyfill'
import { PlayerSDKState } from './types'

const hasScheduler =
  typeof scheduler !== 'undefined' && typeof scheduler.postTask === 'function'
import type { QueueSynchronizer } from './QueueSynchronizer'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'

interface StateProcessorContext {
  getDeviceId(): string | null
  getIsManualPause(): boolean
  log(level: LogLevel, message: string, error?: unknown): void
}

export class StateProcessor {
  private stateChangeInProgress: boolean = false
  private pendingStates: PlayerSDKState[] = []
  private readonly MAX_PENDING_STATES = 10

  constructor(
    private readonly queueSynchronizer: QueueSynchronizer,
    private readonly context: StateProcessorContext
  ) {}

  async processStateChange(
    state: PlayerSDKState,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void> {
    // Serialization: If a state change is already being processed, queue this one
    if (this.stateChangeInProgress) {
      // Add to queue, but limit size to prevent memory issues
      if (this.pendingStates.length < this.MAX_PENDING_STATES) {
        this.pendingStates.push(state)
      } else {
        // Drop oldest state and add new one
        this.pendingStates.shift()
        this.pendingStates.push(state)
      }
      return
    }

    this.stateChangeInProgress = true

    try {
      // Process current state
      if (hasScheduler) {
        await scheduler.postTask(
          () => this.handlePlayerStateChanged(state, onPlaybackStateChange),
          { priority: 'user-blocking' }
        )
      } else {
        await this.handlePlayerStateChanged(state, onPlaybackStateChange)
      }

      // Process all pending states that arrived while we were working
      while (this.pendingStates.length > 0) {
        const nextState = this.pendingStates.shift()!
        if (hasScheduler) {
          await scheduler.postTask(
            () =>
              this.handlePlayerStateChanged(nextState, onPlaybackStateChange),
            { priority: 'user-blocking' }
          )
        } else {
          await this.handlePlayerStateChanged(nextState, onPlaybackStateChange)
        }
      }
    } finally {
      this.stateChangeInProgress = false
    }
  }

  private async handlePlayerStateChanged(
    state: PlayerSDKState,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void> {
    try {
      // Issue #13: SDK state updates indicate this device is active.
      // Cross-device enforcement is handled by AutoPlayService and DeviceValidation.

      if (this.queueSynchronizer.isTrackFinished(state)) {
        await this.queueSynchronizer.handleTrackFinished(state)
      }

      this.queueSynchronizer.syncQueueWithPlayback(state)
      this.queueSynchronizer.setLastKnownState(state)

      const transformedState = this.transformStateForUI(state)
      onPlaybackStateChange(transformedState)
    } catch (error) {
      this.context.log('ERROR', '[StateProcessor] State change handler failed', error)
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
      // Prevent stale SDK events from overwriting an optimistic pause
      is_playing: this.context.getIsManualPause() ? false : !state.paused,
      progress_ms: state.position,
      timestamp: Date.now(),
      context: { uri: '' },
      device: {
        id: this.context.getDeviceId() ?? '',
        is_active: true,
        is_private_session: false,
        is_restricted: false,
        name: 'Jukebox Player',
        type: 'Computer',
        volume_percent: 50
      }
    }
  }
}
