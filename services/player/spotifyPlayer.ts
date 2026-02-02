/**
 * SpotifyPlayer Service
 *
 * Single Responsibility: Manage Spotify Web Playback SDK lifecycle
 * - Load/unload SDK script
 * - Create/destroy player instance
 * - Register and cleanup event listeners
 * - Device verification
 * - Basic player commands
 */

import { sendApiRequest } from '@/shared/api'
import {
  validateDevice,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import { tokenManager } from '@/shared/token/tokenManager'
import { PLAYER_LIFECYCLE_CONFIG } from '../playerLifecycleConfig'
import type {
  PlayerStatus,
  Logger,
  StatusChangeCallback,
  DeviceIdCallback,
  PlaybackStateCallback,
  PlayerSDKState,
  PlayerConfig
} from './types'

// Type guard for runtime validation of PlayerSDKState
function isPlayerSDKState(state: unknown): state is PlayerSDKState {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  const paused = s.paused
  const position = s.position
  const duration = s.duration
  const trackWindow = s.track_window

  // Validate base properties
  if (
    typeof paused !== 'boolean' ||
    typeof position !== 'number' ||
    typeof duration !== 'number' ||
    !trackWindow ||
    typeof trackWindow !== 'object' ||
    !('current_track' in trackWindow)
  ) {
    return false
  }

  // Validate current_track structure if present
  const currentTrack = (trackWindow as Record<string, unknown>).current_track
  if (currentTrack !== null) {
    if (
      typeof currentTrack !== 'object' ||
      !('id' in currentTrack) ||
      !('uri' in currentTrack) ||
      !('name' in currentTrack)
    ) {
      return false
    }
  }

  return true
}

export class SpotifyPlayer {
  private status: PlayerStatus = 'uninitialized'
  private player: Spotify.Player | null = null
  private deviceId: string | null = null
  private logger: Logger | null = null

  // Track cleanup functions for proper resource management
  private eventCleanup: Array<() => void> = []
  private timeouts: Map<string, NodeJS.Timeout> = new Map()

  // Promise resolvers for async initialization
  private deviceReadyResolver: ((deviceId: string) => void) | null = null
  private deviceErrorResolver: ((error: Error) => void) | null = null

  /**
   * Set logger for this service
   */
  setLogger(logger: Logger): void {
    this.logger = logger
  }

  /**
   * Get current player status
   */
  getStatus(): PlayerStatus {
    return this.status
  }

  /**
   * Get device ID (null if not ready)
   */
  getDeviceId(): string | null {
    return this.deviceId
  }

  /**
   * Get underlying Spotify player instance
   */
  getPlayer(): Spotify.Player | null {
    return this.player
  }

  private log(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    error?: unknown
  ): void {
    if (this.logger) {
      this.logger(
        level,
        message,
        'SpotifyPlayer',
        error instanceof Error ? error : undefined
      )
    } else {
      // Fallback: only log warnings and errors
      if (level === 'WARN') {
        console.warn(`[SpotifyPlayer] ${message}`, error)
      } else if (level === 'ERROR') {
        console.error(`[SpotifyPlayer] ${message}`, error)
      }
    }
  }

  private clearTimeout(key: string): void {
    const timeout = this.timeouts.get(key)
    if (timeout) {
      clearTimeout(timeout)
      this.timeouts.delete(key)
    }
  }

  private clearAllTimeouts(): void {
    this.timeouts.forEach((timeout) => clearTimeout(timeout))
    this.timeouts.clear()
  }

  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    const TIMEOUT_MS = PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.verificationTimeout

    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => {
        this.log('WARN', `Device verification timed out after ${TIMEOUT_MS}ms`)
        resolve(false)
      }, TIMEOUT_MS)
    })

    const verificationPromise = validateDevice(deviceId)
      .then(
        (result) => result.isValid && !(result.device?.isRestricted ?? false)
      )
      .catch((error) => {
        this.log('ERROR', 'Device verification failed', error)
        return false
      })

    try {
      const result = await Promise.race([verificationPromise, timeoutPromise])
      return result
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  /**
   * Reload the Spotify SDK script
   */
  async reloadSDK(): Promise<void> {
    this.player = null

    if (typeof window !== 'undefined') {
      window.spotifyPlayerInstance = null
    }

    const existingScript = document.querySelector(
      'script[src*="spotify-player.js"]'
    )
    if (existingScript) {
      existingScript.remove()
    }

    await new Promise((resolve) => setTimeout(resolve, 100))

    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Window not available'))
        return
      }

      let timeoutId: NodeJS.Timeout | null = null
      let isResolved = false

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalReady = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = (): void => {
        cleanup()
        if (originalReady) {
          originalReady()
        }
        if (!isResolved) {
          isResolved = true
          resolve()
        }
      }

      const originalError = window.onSpotifyWebPlaybackSDKError
      window.onSpotifyWebPlaybackSDKError = (error: unknown): void => {
        cleanup()
        this.log('ERROR', 'Failed to reload Spotify SDK', error)
        if (originalError) {
          originalError.call(undefined, error)
        }
        if (!isResolved) {
          isResolved = true
          reject(new Error(`SDK reload failed: ${String(error)}`))
        }
      }

      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.onerror = () => {
        cleanup()
        this.log('ERROR', 'Failed to load Spotify SDK script')
        if (!isResolved) {
          isResolved = true
          reject(new Error('Failed to load Spotify SDK script'))
        }
      }

      document.body.appendChild(script)

      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true
          reject(new Error('SDK reload timeout'))
        }
      }, PLAYER_LIFECYCLE_CONFIG.SDK_RELOAD_TIMEOUT_MS)
    })
  }

  /**
   * Initialize and create the Spotify player
   */
  async initialize(
    onStatusChange: StatusChangeCallback,
    onDeviceIdChange: DeviceIdCallback,
    onPlaybackStateChange: PlaybackStateCallback
  ): Promise<string> {
    // Check preconditions
    if (this.player) {
      throw new Error('Player already exists')
    }

    if (typeof window.Spotify === 'undefined') {
      this.log('ERROR', 'Spotify SDK not loaded')
      onStatusChange('error', 'Spotify SDK not loaded')
      throw new Error('Spotify SDK not loaded')
    }

    try {
      this.clearAllTimeouts()
      this.status = 'initializing'
      onStatusChange('initializing')

      const player = new window.Spotify.Player({
        name: 'Jukebox Player',
        getOAuthToken: (cb) => {
          tokenManager
            .getToken()
            .then((token) => {
              if (!token) {
                this.log(
                  'ERROR',
                  'Token manager returned null token in getOAuthToken callback'
                )
                throw new Error('Token is null')
              }
              cb(token)
            })
            .catch((error) => {
              this.log(
                'ERROR',
                'Error getting token from token manager in getOAuthToken callback',
                error
              )
              throw error
            })
        },
        volume: 0.5
      })

      // Set up event listeners with cleanup tracking
      this.setupEventListeners(
        player,
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )

      // Connect to Spotify
      const connected = await player.connect()
      if (!connected) {
        throw new Error('Failed to connect to Spotify')
      }

      // Store player instance
      this.player = player
      window.spotifyPlayerInstance = player

      // Return promise that resolves when device is ready
      return new Promise<string>((resolve, reject) => {
        // Reject previous promise if it exists
        if (this.deviceReadyResolver) {
          this.deviceErrorResolver?.(new Error('Player creation superseded'))
        }

        const resolveWrapper = (deviceId: string) => {
          this.clearTimeout('initialization')
          resolve(deviceId)
        }

        const rejectWrapper = (error: Error) => {
          this.clearTimeout('initialization')
          reject(error)
        }

        this.deviceReadyResolver = resolveWrapper
        this.deviceErrorResolver = rejectWrapper

        // Set strict initialization timeout
        const initTimeout = setTimeout(() => {
          if (this.deviceErrorResolver === rejectWrapper) {
            this.log(
              'ERROR',
              `Player initialization timed out after ${PLAYER_LIFECYCLE_CONFIG.INITIALIZATION_TIMEOUT_MS}ms`
            )
            rejectWrapper(new Error('Player initialization timed out'))
            this.deviceReadyResolver = null
            this.deviceErrorResolver = null
          }
        }, PLAYER_LIFECYCLE_CONFIG.INITIALIZATION_TIMEOUT_MS)

        this.timeouts.set('initialization', initTimeout)
      })
    } catch (error) {
      this.clearAllTimeouts()
      this.log('ERROR', 'Error creating player', error)
      this.status = 'error'
      throw error
    }
  }

  private setupEventListeners(
    player: Spotify.Player,
    onStatusChange: StatusChangeCallback,
    onDeviceIdChange: DeviceIdCallback,
    onPlaybackStateChange: PlaybackStateCallback
  ): void {
    // Ready event
    const readyHandler = ({ device_id }: { device_id: string }) => {
      void (async () => {
        try {
          if (!this.player) {
            this.log('WARN', 'Player destroyed before ready handler - aborting')
            return
          }

          this.clearTimeout('notReady')
          this.status = 'verifying'
          onStatusChange('verifying')

          // Verify device exists
          const deviceExisted = await this.verifyDeviceWithTimeout(device_id)

          if (!this.player) {
            this.log('WARN', 'Player destroyed during device verification')
            return
          }

          if (!deviceExisted) {
            this.log(
              'WARN',
              'Device verification failed/timed-out. Attempting direct playback transfer as recovery.'
            )
          }

          // Set device ID
          this.deviceId = device_id
          onDeviceIdChange(device_id)

          // Transfer playback to activate device
          const transferSuccess = await transferPlaybackToDevice(device_id)

          if (!this.player) {
            this.log('WARN', 'Player destroyed during playback transfer')
            return
          }

          if (!transferSuccess) {
            this.log('ERROR', 'Failed to transfer playback to new device')
            this.status = 'error'
            onStatusChange('error', 'Failed to transfer playback to new device')
            return
          }

          // Success
          this.status = 'ready'
          onStatusChange('ready')

          // Resolve initialization promise
          if (this.deviceReadyResolver) {
            this.deviceReadyResolver(device_id)
            this.deviceReadyResolver = null
            this.deviceErrorResolver = null
          }
        } catch (error) {
          this.log('ERROR', 'Ready handler failed', error)
          if (this.deviceErrorResolver) {
            this.deviceErrorResolver(
              error instanceof Error ? error : new Error(String(error))
            )
            this.deviceErrorResolver = null
            this.deviceReadyResolver = null
          }
          this.status = 'error'
          onStatusChange('error', 'Device initialization failed')
        }
      })()
    }
    player.addListener('ready', readyHandler)

    // Not ready event
    const notReadyHandler = () => {
      this.log('WARN', 'Device reported as not ready')
      // In Phase 2, this will trigger recovery service
      onStatusChange('error', 'Device not ready')
    }
    player.addListener('not_ready', notReadyHandler)

    // Initialization error
    const initErrorHandler = ({ message }: { message: string }) => {
      this.log('ERROR', `Initialization error: ${message}`)
      this.status = 'error'
      onStatusChange('error', `Initialization error: ${message}`)

      if (this.deviceErrorResolver) {
        this.deviceErrorResolver(new Error(message))
        this.deviceErrorResolver = null
        this.deviceReadyResolver = null
      }
    }
    player.addListener('initialization_error', initErrorHandler)

    // Authentication error - will be handled by RecoveryManager in Phase 3
    const authErrorHandler = ({ message }: { message: string }) => {
      this.log('ERROR', `Authentication error: ${message}`)
      this.status = 'error'
      onStatusChange('error', `Authentication error: ${message}`)
    }
    player.addListener('authentication_error', authErrorHandler)

    // Account error
    const accountErrorHandler = ({ message }: { message: string }) => {
      this.log('ERROR', `Account error: ${message}`)
      this.status = 'error'
      onStatusChange('error', `Account error: ${message}`)
    }
    player.addListener('account_error', accountErrorHandler)

    // Playback error
    const playbackErrorHandler = ({ message }: { message: string }) => {
      this.log('ERROR', `Playback error: ${message}`)
    }
    player.addListener('playback_error', playbackErrorHandler)

    // Player state changed - will be handled by PlaybackService in Phase 2
    const stateChangeHandler = (state: unknown) => {
      if (!state) {
        this.log('WARN', 'Received null state in player_state_changed event')
        return
      }

      if (!isPlayerSDKState(state)) {
        this.log(
          'ERROR',
          'Invalid state shape received in player_state_changed'
        )
        return
      }

      // For now, just pass through to callback
      // In Phase 2, this will be handled by PlaybackService
    }
    player.addListener('player_state_changed', stateChangeHandler)

    // Store cleanup functions for each listener
    this.eventCleanup.push(
      () => player.removeListener('ready', readyHandler),
      () => player.removeListener('not_ready', notReadyHandler),
      () => player.removeListener('initialization_error', initErrorHandler),
      () => player.removeListener('authentication_error', authErrorHandler),
      () => player.removeListener('account_error', accountErrorHandler),
      () => player.removeListener('playback_error', playbackErrorHandler),
      () => player.removeListener('player_state_changed', stateChangeHandler)
    )
  }

  /**
   * Destroy the player and clean up all resources
   */
  destroy(): void {
    this.log('INFO', 'Destroying player and cleaning up resources')

    // Clear all timeouts
    this.clearAllTimeouts()

    // Clean up event listeners explicitly
    this.eventCleanup.forEach((cleanup) => cleanup())
    this.eventCleanup = []

    // Reject any pending device ready promises
    if (this.deviceErrorResolver) {
      this.deviceErrorResolver(new Error('Player destroyed'))
      this.deviceErrorResolver = null
      this.deviceReadyResolver = null
    }

    // Disconnect player
    if (this.player) {
      this.player.disconnect()
      this.player = null
    }

    // Reset state
    this.deviceId = null
    this.status = 'uninitialized'
  }

  /**
   * Play a track on the current device
   */
  async play(trackUri: string): Promise<void> {
    if (!this.deviceId) {
      throw new Error('No device ID available')
    }

    if (this.status !== 'ready') {
      throw new Error(`Player not ready (status: ${this.status})`)
    }

    await sendApiRequest({
      path: `me/player/play?device_id=${this.deviceId}`,
      method: 'PUT',
      body: {
        uris: [trackUri]
      }
    })
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    if (!this.deviceId) {
      throw new Error('No device ID available')
    }

    await sendApiRequest({
      path: `me/player/pause?device_id=${this.deviceId}`,
      method: 'PUT'
    })
  }

  /**
   * Resume playback
   */
  async resume(): Promise<void> {
    if (!this.deviceId) {
      throw new Error('No device ID available')
    }

    await sendApiRequest({
      path: `me/player/play?device_id=${this.deviceId}`,
      method: 'PUT'
    })
  }
}

// Export singleton instance
export const spotifyPlayer = new SpotifyPlayer()
