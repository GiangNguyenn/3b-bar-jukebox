import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { PLAYER_LIFECYCLE_CONFIG } from '@/services/playerLifecycleConfig'
import { recoveryManager } from '@/services/player/recoveryManager'
import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('PlaybackPoller')

const DEFAULT_INTERVAL_MS = 1000

export interface PlaybackPollerCallbacks {
  onState: (state: SpotifyPlaybackState) => Promise<void>
  onNullState: () => Promise<void>
}

export class PlaybackPoller {
  private isRunning = false
  private intervalMs = DEFAULT_INTERVAL_MS
  private intervalRef: NodeJS.Timeout | null = null
  private isPolling = false
  private unsubscribeSuspension: (() => void) | null = null
  private readonly callbacks: PlaybackPollerCallbacks

  constructor(callbacks: PlaybackPollerCallbacks, initialIntervalMs = DEFAULT_INTERVAL_MS) {
    this.callbacks = callbacks
    this.intervalMs = initialIntervalMs
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.isPolling = false

    this.unsubscribeSuspension = recoveryManager.onSuspensionChange((suspended) => {
      if (suspended) {
        log('WARN', 'Token suspended — pausing polling')
        this.clearInterval()
      } else {
        log('INFO', 'Token recovered — resuming polling')
        if (this.isRunning) this.startInterval()
      }
    })

    this.startInterval()
  }

  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    this.isPolling = false
    this.clearInterval()
    if (this.unsubscribeSuspension) {
      this.unsubscribeSuspension()
      this.unsubscribeSuspension = null
    }
  }

  isActive(): boolean {
    return this.isRunning
  }

  /** Fires an immediate poll outside of the regular interval. */
  triggerPoll(): void {
    void this.poll().catch(() => {})
  }

  /**
   * Dynamically adjusts poll frequency based on how close the track is to ending.
   * Call this from the onState callback after each successful state fetch.
   */
  adjustInterval(state: SpotifyPlaybackState): void {
    if (!state.item || !state.is_playing) return

    const progress = state.progress_ms ?? 0
    const duration = state.item.duration_ms ?? 0
    const timeRemaining = duration - progress

    let newInterval: number
    if (timeRemaining <= 10000) {
      newInterval = 100 // Last 10s: 100ms for precise detection
    } else if (timeRemaining <= 30000) {
      newInterval = 250 // Last 30s: 250ms
    } else {
      newInterval = 1000 // Mid-track: 1s to reduce API calls
    }

    if (newInterval !== this.intervalMs) {
      this.intervalMs = newInterval
      this.startInterval()
    }
  }

  private startInterval(): void {
    this.clearInterval()
    this.intervalRef = setInterval(() => {
      void this.poll().catch(() => this.stop())
    }, this.intervalMs)
  }

  private clearInterval(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef)
      this.intervalRef = null
    }
  }

  private async poll(): Promise<void> {
    if (recoveryManager.isTokenSuspended()) return
    if (this.isPolling) return

    this.isPolling = true
    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state) {
        await this.callbacks.onNullState()
      } else {
        await this.callbacks.onState(state)
      }
    } finally {
      this.isPolling = false
    }
  }
}
