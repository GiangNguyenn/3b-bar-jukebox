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
  readonly timeoutManager: TimeoutManager = new TimeoutManager()

  constructor(private readonly dispatcher: PlayerEventDispatcher) {}

  setLogger(logger: AddLogFn): void {
    this.addLog = logger
  }

  getDeviceId(): string | null {
    return this.deviceId
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

    try {
      await waitForSpotifySDK()
    } catch (error) {
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
        onPlaybackStateChange
      )
      handler.attachListeners(player)

      const connected = await player.connect()
      if (!connected) {
        throw new Error('Failed to connect to Spotify')
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
              rejectWrapper(new Error('Player initialization timed out'))
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

    await this.verifyDeviceWithTimeout(deviceId)

    if (!this.playerRef) {
      return
    }

    this.deviceId = deviceId
    onDeviceIdChange(deviceId)

    const transferSuccess = await transferPlaybackToDevice(deviceId)

    if (!this.playerRef) {
      return
    }

    if (!transferSuccess) {
      onStatusChange('error', 'Failed to transfer playback to new device')
      return
    }

    onStatusChange('ready')
    recoveryManager.recordSuccess()

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
      .then((result) => result.isValid && !(result.device?.isRestricted ?? false))
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

    spotifyPlayer.destroy()
  }
}
