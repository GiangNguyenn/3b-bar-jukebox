import { sendApiRequest } from '@/shared/api'
import { showToast } from '@/lib/toast'
import { calculateBackoffDelay } from '@/shared/utils/retryHelpers'
import {
  transferPlaybackToDevice,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { queueManager } from '@/services/queueManager'
import { PLAYER_LIFECYCLE_CONFIG } from './playerLifecycleConfig'
import { LogEntry } from '@/shared/types/health'
import {
  spotifyPlayer,
  playbackService,
  recoveryManager
} from '@/services/player'
import { QueueSynchronizer } from './playerLifecycle/QueueSynchronizer'
import { SDKLifecycleManager } from './playerLifecycle/SDKLifecycleManager'
import { DeviceErrorHandler } from './playerLifecycle/DeviceErrorHandler'
import { StateProcessor } from './playerLifecycle/StateProcessor'

// Type for the navigation callback
export type NavigationCallback = (path: string) => void

/**
 * Coordinator for the Spotify Web Playback SDK lifecycle.
 *
 * Responsibilities:
 * - Wires together three sub-modules: SDKLifecycleManager, DeviceErrorHandler, StateProcessor
 * - Owns the PlaybackController interface consumed by QueueSynchronizer (playTrackWithRetry)
 * - Exposes the public API consumed by React hooks and recovery utilities
 * - Manages the logging buffer and manual-pause flag
 *
 * Sub-module responsibilities:
 * - SDKLifecycleManager: player creation, device activation, SDK teardown
 * - DeviceErrorHandler: auth recovery, null-state handling, account/device errors
 * - StateProcessor: state-change serialization, UI state transformation
 * - QueueSynchronizer: queue-to-playback sync, duplicate detection, track finish detection
 */
class PlayerLifecycleService {
  /**
   * Tracks if the playback was paused manually by the user via the Jukebox UI.
   * This is used to differentiate between system-initiated pauses (errors, etc.)
   * and intentional user actions.
   */
  private isManualPause: boolean = false
  private addLog:
    | ((
        level: LogLevel,
        message: string,
        context?: string,
        error?: Error
      ) => void)
    | null = null
  private navigationCallback: NavigationCallback | null = null

  // Phase 4: Internal Log History (Circular Buffer)
  private internalLogBuffer: LogEntry[] = []
  private readonly MAX_LOG_HISTORY = 100

  private sdkLifecycleManager: SDKLifecycleManager
  private deviceErrorHandler: DeviceErrorHandler
  private stateProcessor: StateProcessor
  private queueSynchronizer: QueueSynchronizer

  constructor() {
    this.sdkLifecycleManager = new SDKLifecycleManager(this)
    this.queueSynchronizer = new QueueSynchronizer(this)
    this.stateProcessor = new StateProcessor(this.queueSynchronizer, {
      getDeviceId: () => this.sdkLifecycleManager.getDeviceId(),
      getIsManualPause: () => this.isManualPause,
      log: (level, msg, error) => this.log(level, msg, error)
    })
    this.deviceErrorHandler = new DeviceErrorHandler(
      {
        createPlayer: (onS, onD, onP) => this.createPlayer(onS, onD, onP),
        destroyPlayer: (opts) => this.destroyPlayer(opts),
        reloadSDK: () => this.reloadSDK(),
        getDeviceId: () => this.sdkLifecycleManager.getDeviceId(),
        getPlayerRef: () => this.sdkLifecycleManager.getPlayerRef()
      },
      this.sdkLifecycleManager.timeoutManager,
      {
        getNavigationCallback: () => this.navigationCallback,
        log: (level, msg, error) => this.log(level, msg, error),
        stateProcessor: this.stateProcessor
      }
    )
  }

  getDeviceId(): string | null {
    return this.sdkLifecycleManager.getDeviceId()
  }

  setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ): void {
    this.addLog = logger
    this.sdkLifecycleManager.setLogger(logger)
    spotifyPlayer.setLogger(logger)
    playbackService.setLogger(logger)
    recoveryManager.setLogger(logger)
    setDeviceManagementLogger(logger)
  }

  setNavigationCallback(callback: NavigationCallback | null): void {
    this.navigationCallback = callback
  }

  initializeQueue(): void {
    this.queueSynchronizer.initializeQueue()
  }

  log(level: LogLevel, message: string, error?: unknown): void {
    // Capture to internal buffer
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: level as LogEntry['level'],
      message,
      details:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error
    }

    this.internalLogBuffer.push(entry)
    if (this.internalLogBuffer.length > this.MAX_LOG_HISTORY) {
      this.internalLogBuffer.shift()
    }

    if (this.addLog) {
      this.addLog(
        level,
        message,
        'PlayerLifecycle',
        error instanceof Error ? error : undefined
      )
    } else {
      // Fallback: only log warnings and errors
      if (level === 'WARN') {
        console.warn(`[PlayerLifecycle] ${message}`, error)
      } else if (level === 'ERROR') {
        console.error(`[PlayerLifecycle] ${message}`, error)
      }
    }
  }

  async playTrackWithRetry(
    trackUri: string,
    deviceId: string,
    maxRetries = PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxRetriesPerTrack
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await sendApiRequest({
          path: `me/player/play?device_id=${deviceId}`,
          method: 'PUT',
          body: {
            uris: [trackUri]
          }
        })

        // Reset manual pause flag on successful playback start
        this.isManualPause = false

        return true
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        // Handle "Restriction violated" or "Device not found"
        // On the first attempt, this may simply mean the device is not active yet (e.g. fresh load).
        // We can safely try transferring playback to it explicitly, then retrying.
        if (
          attempt === 0 &&
          (errorMessage.includes('Restriction violated') ||
            errorMessage.includes('Device not found') ||
            errorMessage.includes('404'))
        ) {
          this.log(
            'INFO',
            `Playback restriction on first attempt. Attempting to activate device ${deviceId}...`
          )
          // Attempt to activate the device (shouldPlay: true, aggressively wake up audio context)
          const activated = await transferPlaybackToDevice(
            deviceId,
            3,
            1000,
            true,
            true
          )
          if (!activated) {
            this.log(
              'WARN',
              `Device activation failed for device ${deviceId}. Playback retry will likely fail.`
            )
          } else {
            this.log(
              'INFO',
              `Device activation succeeded for device ${deviceId}.`
            )
          }
          // Continue to backoff and retry
        } else if (errorMessage.includes('Restriction violated')) {
          this.log('WARN', 'Restriction violated on retry, skipping track.')
          return false // Don't retry further, just skip this track
        }

        // If we've exhausted retries, fail
        if (attempt === maxRetries) {
          return false
        }

        const maxBackoffMs =
          PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.initialBackoffMs *
          Math.pow(
            2,
            PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxBackoffMultiplier
          )
        const backoffMs = calculateBackoffDelay(
          attempt,
          PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.initialBackoffMs,
          maxBackoffMs
        )
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }
    return false
  }

  async playNextTrack(track: JukeboxQueueItem): Promise<void> {
    // Reset manual pause flag when starting next track
    this.isManualPause = false
    await this.queueSynchronizer.playNextTrack(track)
  }

  getDiagnostics(): {
    authRetryCount: number
    activeTimeouts: string[]
    internalLogs: LogEntry[]
  } {
    return {
      authRetryCount: recoveryManager.getRetryCount(),
      activeTimeouts: this.sdkLifecycleManager.timeoutManager.getActiveKeys(),
      internalLogs: [...this.internalLogBuffer].reverse() // Newest first
    }
  }

  // Delegation stubs — bodies live in DeviceErrorHandler

  async handleAuthenticationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void> {
    return this.deviceErrorHandler.handleAuthenticationError(
      message,
      onStatusChange,
      onDeviceIdChange,
      onPlaybackStateChange
    )
  }

  handleAccountError(message: string): void {
    return this.deviceErrorHandler.handleAccountError(message)
  }

  async forceRecovery(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void> {
    return this.deviceErrorHandler.forceRecovery(
      onStatusChange,
      onDeviceIdChange,
      onPlaybackStateChange
    )
  }

  handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    return this.deviceErrorHandler.handleNotReady(deviceId, onStatusChange)
  }

  handlePlaybackError(message: string): void {
    if (message.includes('Restriction violated')) {
      void this.queueSynchronizer
        .handleRestrictionViolatedError()
        .catch(() => {})
    }
  }

  handlePlayerStateChangeEvent(
    state: unknown,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): void {
    return this.deviceErrorHandler.handlePlayerStateChangeEvent(
      state,
      onPlaybackStateChange,
      onStatusChange,
      onDeviceIdChange
    )
  }

  // Delegation stubs — bodies live in SDKLifecycleManager

  async handleDeviceReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): Promise<void> {
    return this.sdkLifecycleManager.handleDeviceReady(
      deviceId,
      onStatusChange,
      onDeviceIdChange
    )
  }

  handleInitializationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    return this.sdkLifecycleManager.handleInitializationError(
      message,
      onStatusChange
    )
  }

  handleDeviceInitializationFailure(
    error: unknown,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    return this.sdkLifecycleManager.handleDeviceInitializationFailure(
      error,
      onStatusChange
    )
  }

  async createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<string> {
    return this.sdkLifecycleManager.createPlayer(
      onStatusChange,
      onDeviceIdChange,
      onPlaybackStateChange
    )
  }

  destroyPlayer(
    options: { resetRecovery: boolean } = { resetRecovery: true }
  ): void {
    this.sdkLifecycleManager.destroyPlayer()
    this.deviceErrorHandler.reset()

    this.queueSynchronizer.reset()
    if (options.resetRecovery) {
      recoveryManager.reset()
    }
  }

  getPlayer(): Spotify.Player | null {
    return this.sdkLifecycleManager.getPlayerRef()
  }

  getLastSDKStateUpdateTime(): number {
    return this.queueSynchronizer.getLastStateUpdateTime()
  }

  async playNextFromQueue(): Promise<void> {
    const nextTrack = queueManager.getNextTrack()
    if (!nextTrack) {
      this.log('WARN', 'playNextFromQueue: queue is empty, nothing to play')
      showToast('Queue is empty — nothing to play.', 'warning')
      return
    }
    await this.playNextTrack(nextTrack)
  }

  // Distinct from playNextFromQueue: the caller pre-fetches the track before any
  // async gap, avoiding the pause→SDK-state-change→handleTrackFinished race.
  async skipToTrack(nextTrack: JukeboxQueueItem): Promise<void> {
    await this.playNextTrack(nextTrack)
  }

  async reloadSDK(): Promise<void> {
    return this.sdkLifecycleManager.reloadSDK()
  }

  public setManualPause(isManualPause: boolean): void {
    this.isManualPause = isManualPause
  }

  public getIsManualPause(): boolean {
    return this.isManualPause
  }

  public async resumePlayback(): Promise<void> {
    if (!this.sdkLifecycleManager.getDeviceId()) {
      return
    }

    await spotifyPlayer.resume()
    this.isManualPause = false
  }
}

// Export singleton instance
export const playerLifecycleService = new PlayerLifecycleService()

// Phase 4: Export class for testing
// This allows tests to create isolated instances with mocked dependencies
export { PlayerLifecycleService }
