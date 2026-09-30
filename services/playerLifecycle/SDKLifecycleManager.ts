import { waitForSpotifySDK, TimeoutManager } from './utils'
import {
  validateDevice,
  transferPlaybackToDevice,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import { tokenManager } from '@/shared/token/tokenManager'
import { spotifyPlayer, recoveryManager } from '@/services/player'
import { PlayerEventHandler } from './PlayerEventHandler'
import { PLAYER_LIFECYCLE_CONFIG } from '../playerLifecycleConfig'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { PlayerEventDispatcher } from './types'
import {
  describeTabVisibility,
  formatDuration
} from '@/shared/utils/tabVisibility'

const TRANSFER_ATTEMPTS = 4
const TRANSFER_RETRY_DELAY_MS = 1500

type AddLogFn = (
  level: LogLevel,
  message: string,
  context?: string,
  error?: Error
) => void

export class SDKLifecycleManager {
  private playerRef: Spotify.Player | null = null
  private deviceId: string | null = null
  private deviceReadyResolver: ((deviceId: string) => void) | null = null
  private deviceErrorResolver: ((error: Error) => void) | null = null
  private pendingPromiseCleanup: (() => void) | null = null
  private addLog: AddLogFn | null = null
  // Which step of player setup is in progress, so that a timeout or failure
  // can say where it got stuck
  private setup: { startedAt: number; step: string; stepStartedAt: number } = {
    startedAt: 0,
    step: 'not started',
    stepStartedAt: 0
  }
  readonly timeoutManager: TimeoutManager = new TimeoutManager()

  constructor(private readonly dispatcher: PlayerEventDispatcher) {}

  setLogger(logger: AddLogFn): void {
    this.addLog = logger
  }

  getDeviceId(): string | null {
    return this.deviceId
  }

  private logSetup(level: LogLevel, message: string): void {
    this.addLog?.(level, message, 'PlayerInit')
  }

  private beginSetupStep(step: string, isFirst = false): void {
    const now = Date.now()
    if (isFirst) this.setup.startedAt = now
    this.setup.step = step
    this.setup.stepStartedAt = now
    this.logSetup(
      'INFO',
      `Player setup: ${step}${isFirst ? ` (tab ${describeTabVisibility()})` : ''}`
    )
  }

  /** e.g. "after 30s, while waiting for ... (28s in that step; tab hidden for 4m 2s)" */
  private describeSetupProgress(): string {
    const now = Date.now()
    return `after ${formatDuration(now - this.setup.startedAt)}, while ${this.setup.step} (${formatDuration(now - this.setup.stepStartedAt)} in that step; tab ${describeTabVisibility()})`
  }

  getPlayerRef(): Spotify.Player | null {
    return this.playerRef
  }

  async createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<string> {
    if (typeof window === 'undefined') {
      throw new Error('Player cannot be initialized on server')
    }

    if (this.playerRef) {
      throw new Error('Player already exists')
    }

    this.beginSetupStep('loading the Spotify SDK script', true)
    try {
      await waitForSpotifySDK()
    } catch (error) {
      this.logSetup(
        'ERROR',
        `Player setup failed: the Spotify SDK script did not load (tab ${describeTabVisibility()})`
      )
      onStatusChange('error', 'Spotify SDK failed to load')
      throw error
    }

    if (typeof window.Spotify === 'undefined') {
      onStatusChange('error', 'Spotify SDK not loaded')
      throw new Error('Spotify SDK not loaded')
    }

    try {
      setDeviceManagementLogger(
        this.addLog ??
          ((level, message, _context, error) => {
            if (level === 'WARN') {
              console.warn(`[DeviceManagement] ${message}`, error)
            } else if (level === 'ERROR') {
              console.error(`[DeviceManagement] ${message}`, error)
            }
          })
      )

      this.timeoutManager.clear('cleanup')

      onStatusChange('initializing')

      const player = new window.Spotify.Player({
        name: 'Jukebox Player',
        getOAuthToken: (cb) => {
          tokenManager
            .getToken()
            .then((token) => {
              if (!token) {
                throw new Error('Token is null')
              }
              cb(token)
            })
            .catch(() => {
              // Resolve with empty string to trigger SDK authentication_error
              // preventing unhandled promise rejection
              cb('')
            })
        },
        volume: 0.5
      })

      const handler = new PlayerEventHandler(
        this.dispatcher,
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange,
        (level, message) => this.addLog?.(level, message, 'SpotifySDK')
      )
      handler.attachListeners(player)

      this.beginSetupStep('connecting to Spotify')
      const connected = await player.connect()
      if (!connected) {
        this.logSetup(
          'ERROR',
          `Player setup failed: the SDK could not connect to Spotify (tab ${describeTabVisibility()})`
        )
        throw new Error('Failed to connect to Spotify')
      }
      // handleDeviceReady may already have moved setup on by now
      if (this.setup.step === 'connecting to Spotify') {
        this.beginSetupStep('waiting for Spotify to report the device ready')
      }

      this.playerRef = player
      window.spotifyPlayerInstance = player

      return new Promise<string>((resolve, reject) => {
        if (this.deviceReadyResolver) {
          this.deviceErrorResolver?.(new Error('Player creation superseded'))
        }

        const resolveWrapper = (deviceId: string) => {
          this.timeoutManager.clear('initialization')
          resolve(deviceId)
        }

        const rejectWrapper = (error: Error) => {
          this.timeoutManager.clear('initialization')
          reject(error)
        }

        this.deviceReadyResolver = resolveWrapper
        this.deviceErrorResolver = rejectWrapper

        this.timeoutManager.setTask(
          'initialization',
          () => {
            if (this.deviceErrorResolver === rejectWrapper) {
              if (this.pendingPromiseCleanup) {
                this.pendingPromiseCleanup()
                this.pendingPromiseCleanup = null
              }
              const progress = this.describeSetupProgress()
              this.logSetup('ERROR', `Player setup timed out ${progress}`)
              rejectWrapper(
                new Error(`Player initialization timed out ${progress}`)
              )
            }
          },
          PLAYER_LIFECYCLE_CONFIG.INITIALIZATION_TIMEOUT_MS,
          'user-blocking'
        )

        this.pendingPromiseCleanup = () => {
          this.deviceReadyResolver = null
          this.deviceErrorResolver = null
          this.timeoutManager.clear('initialization')
        }
      })
    } catch (error) {
      this.timeoutManager.clearAll()
      throw error
    }
  }

  async handleDeviceReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): Promise<void> {
    if (!this.playerRef) {
      return
    }

    this.timeoutManager.clear('notReady')
    onStatusChange('verifying')

    this.beginSetupStep('verifying the new device with Spotify')
    const verified = await this.verifyDeviceWithTimeout(deviceId)
    if (!verified) {
      this.logSetup(
        'WARN',
        'Player setup: Spotify does not list the new device yet; trying to move playback to it anyway'
      )
    }

    if (!this.playerRef) {
      return
    }

    this.deviceId = deviceId
    onDeviceIdChange(deviceId)

    // A freshly registered device can take a few seconds to show up in
    // Spotify's device list, and the transfer validates against that list.
    // Failing on the first miss would mark the new player 'error' and cost a
    // whole extra recovery cycle.
    let transferSuccess = false
    for (let attempt = 0; attempt < TRANSFER_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, TRANSFER_RETRY_DELAY_MS)
        )
      }
      if (!this.playerRef || this.deviceId !== deviceId) {
        return
      }
      this.beginSetupStep(
        `moving playback to the new device (attempt ${attempt + 1} of ${TRANSFER_ATTEMPTS})`
      )
      transferSuccess = await transferPlaybackToDevice(deviceId)
      if (transferSuccess) break
    }

    if (!this.playerRef || this.deviceId !== deviceId) {
      return
    }

    if (!transferSuccess) {
      this.logSetup(
        'ERROR',
        `Player setup failed: the SDK reported the device ready, but playback could not be moved to it in ${TRANSFER_ATTEMPTS} attempts, ${formatDuration(Date.now() - this.setup.startedAt)} after setup began (tab ${describeTabVisibility()})`
      )
      this.setup.step =
        'giving up after playback could not be moved to the device'
      this.setup.stepStartedAt = Date.now()
      onStatusChange('error', 'Failed to transfer playback to new device')
      return
    }

    this.logSetup(
      'INFO',
      `Player setup complete in ${formatDuration(Date.now() - this.setup.startedAt)}`
    )
    this.setup.step = 'complete'
    onStatusChange('ready')
    recoveryManager.recordSuccess()
    this.dispatcher.onPlayerReady?.(deviceId)

    if (this.deviceReadyResolver) {
      this.deviceReadyResolver(deviceId)
      this.deviceReadyResolver = null
      this.deviceErrorResolver = null
    }

    // Enforce Repeat Mode 'off' after device is ready to prevent tracks from
    // seamlessly looping, which would bypass track finish detection.
    try {
      const SpotifyApiService = (await import('@/services/spotifyApi'))
        .SpotifyApiService
      await SpotifyApiService.getInstance().setRepeatMode('off', deviceId)
    } catch {
      // Log warning but don't fail initialization
    }
  }

  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    const TIMEOUT_MS = PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.verificationTimeout

    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve(false)
      }, TIMEOUT_MS)
    })

    const verificationPromise = validateDevice(deviceId)
      .then(
        (result) => result.isValid && !(result.device?.isRestricted ?? false)
      )
      .catch(() => false)

    try {
      return await Promise.race([verificationPromise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  handleInitializationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    onStatusChange(
      'error',
      `Initialization error: ${message}. Check console for details.`
    )

    if (this.deviceErrorResolver) {
      this.deviceErrorResolver(new Error(message))
      this.deviceErrorResolver = null
      this.deviceReadyResolver = null
    }
  }

  handleDeviceInitializationFailure(
    error: unknown,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    if (this.deviceErrorResolver) {
      this.deviceErrorResolver(
        error instanceof Error ? error : new Error(String(error))
      )
      this.deviceErrorResolver = null
      this.deviceReadyResolver = null
    }
    onStatusChange('error', 'Device initialization failed')
  }

  async reloadSDK(): Promise<void> {
    await spotifyPlayer.reloadSDK()
    this.playerRef = null
    if (typeof window !== 'undefined') {
      window.spotifyPlayerInstance = null
    }
  }

  destroyPlayer(): void {
    this.timeoutManager.clearAll()

    if (this.pendingPromiseCleanup) {
      this.pendingPromiseCleanup()
      this.pendingPromiseCleanup = null
    }

    if (this.deviceErrorResolver) {
      this.deviceErrorResolver(new Error('Player destroyed'))
      this.deviceErrorResolver = null
      this.deviceReadyResolver = null
    }

    if (this.playerRef) {
      this.playerRef.disconnect()
      this.playerRef = null
    }
    // The old device is gone; commands sent to it would only fail. The next
    // 'ready' event sets the new one.
    this.deviceId = null

    spotifyPlayer.destroy()
  }
}
