import { sendApiRequest } from '@/shared/api'
import {
  validateDevice,
  transferPlaybackToDevice,
  cleanupOtherDevices,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import {
  SpotifySDKPlaybackState,
  SpotifyPlayerInstance,
  SpotifySDK
} from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'

type SpotifySDKEventTypes =
  | 'ready'
  | 'not_ready'
  | 'player_state_changed'
  | 'initialization_error'
  | 'authentication_error'
  | 'account_error'
  | 'playback_error'

type SpotifySDKEventCallbacks = {
  ready: (event: { device_id: string }) => void
  not_ready: (event: { device_id: string }) => void
  player_state_changed: (state: SpotifySDKPlaybackState) => void
  initialization_error: (event: { message: string }) => void
  authentication_error: (event: { message: string }) => void
  account_error: (event: { message: string }) => void
  playback_error: (event: { message: string }) => void
}

// @ts-ignore - Spotify SDK type definitions are incomplete
declare global {
  interface Window {
    Spotify: typeof Spotify
    spotifyPlayerInstance: any // Use any to avoid type conflicts
    onSpotifyWebPlaybackSDKError?: (error: any) => void // Added for local error handler
  }
}

// Player lifecycle management service
class PlayerLifecycleService {
  private playerRef: Spotify.Player | null = null
  private lastKnownState: any | null = null
  private currentQueueTrack: JukeboxQueueItem | null = null
  private deviceId: string | null = null
  private cleanupTimeoutRef: NodeJS.Timeout | null = null
  private notReadyTimeoutRef: NodeJS.Timeout | null = null
  private reconnectionTimeoutRef: NodeJS.Timeout | null = null
  private verificationTimeoutRef: NodeJS.Timeout | null = null
  private addLog:
    | ((
        level: LogLevel,
        message: string,
        context?: string,
        error?: Error
      ) => void)
    | null = null

  // State machine configuration
  private readonly STATE_MACHINE_CONFIG = {
    GRACE_PERIODS: {
      notReadyToReconnecting: 3000, // 3 seconds before considering device lost
      reconnectingToError: 15000, // 15 seconds before giving up on reconnection
      verificationTimeout: 5000 // 5 seconds for device verification (reduced from 10)
    },
    MAX_CONSECUTIVE_FAILURES: 3,
    MAX_RECONNECTION_ATTEMPTS: 5,
    STATUS_DEBOUNCE: 1000 // 1 second debounce for status changes
  } as const

  setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ) {
    this.addLog = logger
  }

  async initializeQueue(playlistId: string) {
    this.log('INFO', `Initializing queue with playlist ID: ${playlistId}`)
    // The queueManager is now a singleton and doesn't need initialization here.
    // The queue will be updated by another service that fetches playlist data.
    this.currentQueueTrack = queueManager.getNextTrack() ?? null
  }

  private async checkAndAutoFillQueue(): Promise<void> {
    const queue = queueManager.getQueue()

    // Check if queue is low (3 or fewer tracks remaining)
    if (queue.length <= 3) {
      this.log(
        'INFO',
        `Queue is low (${queue.length} tracks remaining), triggering auto-fill`
      )

      try {
        // Get track suggestions
        const response = await fetch('/api/track-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}) // Use default parameters for auto-fill
        })

        if (!response.ok) {
          const errorBody = await response.json()
          this.log(
            'ERROR',
            `Track Suggestions API error: ${JSON.stringify(errorBody)}`
          )
          return
        }

        const suggestions = (await response.json()) as {
          tracks: { id: string }[]
        }

        this.log(
          'INFO',
          `Got ${suggestions.tracks.length} track suggestions for auto-fill`
        )

        // Note: We can't add tracks to queue here since we don't have username context
        // This is primarily for logging purposes in the PlayerLifecycleService
        // The actual auto-fill is handled by the AutoPlayService which has username context
      } catch (error) {
        this.log('ERROR', 'Failed to check auto-fill queue', error)
      }
    }
  }

  private log(level: LogLevel, message: string, error?: unknown) {
    if (this.addLog) {
      this.addLog(
        level,
        message,
        'PlayerLifecycle',
        error instanceof Error ? error : undefined
      )
    } else {
      // Fallback logging when logger is not set up
      const logMessage = `[PlayerLifecycle] ${level}: ${message}`
      if (error) {
        console.error(logMessage, error)
      } else {
        console.log(logMessage)
      }
    }
  }

  // Robust device verification with timeout
  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.log('WARN', 'Device verification timed out')
        resolve(false)
      }, this.STATE_MACHINE_CONFIG.GRACE_PERIODS.verificationTimeout)

      this.verificationTimeoutRef = timeout

      validateDevice(deviceId)
        .then((result) => {
          clearTimeout(timeout)
          resolve(result.isValid && !(result.device?.isRestricted ?? false))
        })
        .catch((error) => {
          clearTimeout(timeout)
          this.log('ERROR', 'Device verification failed', error)
          resolve(false)
        })
    })
  }

  // Handle 'not_ready' with grace period
  private async handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ) {
    this.log('WARN', `Device ${deviceId} reported as not ready`)

    // Clear any existing not-ready timeout
    if (this.notReadyTimeoutRef) {
      clearTimeout(this.notReadyTimeoutRef)
    }

    // Set a grace period before transitioning to reconnecting
    this.notReadyTimeoutRef = setTimeout(async () => {
      onStatusChange('reconnecting')

      // Try to recover by checking for alternative devices
      try {
        const devicesResponse = await sendApiRequest<{
          devices: Array<{
            id: string
            is_active: boolean
            name: string
          }>
        }>({
          path: 'me/player/devices',
          method: 'GET'
        })

        if (devicesResponse?.devices) {
          const availableDevice = devicesResponse.devices.find(
            (d) => d.id !== deviceId && d.is_active
          )

          if (availableDevice) {
            const transferSuccess = await transferPlaybackToDevice(
              availableDevice.id
            )
            if (transferSuccess) {
              onStatusChange('ready')
              return
            }
          }
        }
      } catch (error) {
        this.log('ERROR', 'Failed to find alternative device', error)
      }

      // If recovery failed, transition to error
      onStatusChange('error', 'Device recovery failed')
    }, this.STATE_MACHINE_CONFIG.GRACE_PERIODS.notReadyToReconnecting)
  }

  createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: any) => void
  ): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      if (this.playerRef) {
        reject(new Error('Player already exists'))
        return
      }

      if (typeof window.Spotify === 'undefined') {
        this.log('ERROR', 'Spotify SDK not loaded')
        onStatusChange('error', 'Spotify SDK not loaded')
        reject(new Error('Spotify SDK not loaded'))
        return
      }

      try {
        // Set up device management logger
        setDeviceManagementLogger(this.addLog || console.log)

        // Clear any existing cleanup timeout
        if (this.cleanupTimeoutRef) {
          clearTimeout(this.cleanupTimeoutRef)
        }

        // Set status to initializing (the state machine will handle duplicate transitions)
        onStatusChange('initializing')

        const player = new window.Spotify.Player({
          name: 'Jukebox Player',
          getOAuthToken: async (cb) => {
            try {
              const token = await tokenManager.getToken()
              cb(token)
            } catch (error) {
              this.log('ERROR', 'Error getting token from token manager', error)
              throw error
            }
          },
          volume: 0.5
        })

        // Set up event listeners
        player.addListener('ready', async ({ device_id }) => {
          // Clear any not-ready timeout since we're ready
          if (this.notReadyTimeoutRef) {
            clearTimeout(this.notReadyTimeoutRef)
          }

          onStatusChange('verifying')

          // Use robust device verification with timeout
          const deviceVerified = await this.verifyDeviceWithTimeout(device_id)
          if (!deviceVerified) {
            this.log(
              'WARN',
              'Device setup verification failed, but proceeding anyway'
            )
            // Don't fail the initialization, just warn and proceed
          }

          this.deviceId = device_id
          onDeviceIdChange(device_id)

          // Automatically transfer playback to the new device
          const transferSuccess = await transferPlaybackToDevice(device_id)
          if (transferSuccess) {
            onStatusChange('ready')
          } else {
            this.log('ERROR', 'Failed to transfer playback to new device')
            onStatusChange('error', 'Failed to transfer playback')
          }

          onStatusChange('ready')
          resolve(device_id)
        })

        player.addListener('not_ready', (event) => {
          this.handleNotReady(event.device_id, onStatusChange)
        })

        player.addListener('initialization_error', ({ message }) => {
          this.log('ERROR', `Failed to initialize: ${message}`)
          onStatusChange('error', `Initialization error: ${message}`)
          reject(new Error(message))
        })

        player.addListener('authentication_error', async ({ message }) => {
          this.log('ERROR', `Failed to authenticate: ${message}`)

          // Try to refresh token and recreate player
          try {
            // Clear token cache to force refresh
            tokenManager.clearCache()

            // Attempt to get fresh token
            await tokenManager.getToken()

            // Recreate player with fresh token
            onStatusChange('initializing', 'Refreshing authentication')

            // Destroy current player and recreate
            this.destroyPlayer()
            await this.createPlayer(
              onStatusChange,
              onDeviceIdChange,
              onPlaybackStateChange
            )
          } catch (error) {
            this.log(
              'ERROR',
              'Failed to recover from authentication error',
              error
            )
            onStatusChange('error', `Authentication error: ${message}`)
          }
        })

        player.addListener('account_error', ({ message }) => {
          this.log('ERROR', `Account error: ${message}`)
          onStatusChange('error', `Account error: ${message}`)
        })

        player.addListener('playback_error', ({ message }) => {
          this.log('ERROR', `Playback error: ${message}`)
          // Don't change status for playback errors, let health monitor handle recovery
          this.log(
            'WARN',
            'Playback error occurred, but recovery is handled by health monitor'
          )
        })

        player.addListener('player_state_changed', (state: any) => {
          if (!state) {
            this.log(
              'WARN',
              'Received null state in player_state_changed event. Device is likely inactive. Triggering recovery.'
            )
            onStatusChange('reconnecting', 'Device became inactive')
            return
          }

          // Use a self-invoking async function to handle async logic
          ;(async () => {
            // The queueManager is now a singleton and always available.

            // --- Track Finished Logic ---
            const trackJustFinished =
              this.lastKnownState &&
              !this.lastKnownState.paused && // was playing
              state.paused && // is now paused
              state.position === 0 && // at the beginning
              this.lastKnownState.track_window.current_track?.uri ===
                state.track_window.current_track?.uri

            if (trackJustFinished && this.currentQueueTrack) {
              const finishedTrackId = this.currentQueueTrack.id
              this.log(
                'INFO',
                `Track finished: ${finishedTrackId}. Marking as played.`
              )

              await queueManager.markAsPlayed(finishedTrackId)

              // Check if queue is getting low and trigger auto-fill if needed
              await this.checkAndAutoFillQueue()

              const nextTrack = queueManager.getNextTrack()

              if (nextTrack) {
                this.log(
                  'INFO',
                  `Playing next track from queue: ${nextTrack.tracks.spotify_url}`
                )
                this.currentQueueTrack = nextTrack

                if (this.deviceId) {
                  try {
                    await sendApiRequest({
                      path: 'me/player/play',
                      method: 'PUT',
                      body: {
                        device_id: this.deviceId,
                        uris: [nextTrack.tracks.spotify_url]
                      }
                    })
                  } catch (error) {
                    this.log('ERROR', 'Failed to play next track', error)
                  }
                } else {
                  this.log(
                    'ERROR',
                    'No device ID available to play next track.'
                  )
                }
              } else {
                this.log('INFO', 'Queue is empty. Playback stopped.')
                this.currentQueueTrack = null
              }
            }

            // --- State Synchronization Logic ---
            const currentSpotifyTrack = state.track_window?.current_track
            if (currentSpotifyTrack && !state.paused) {
              if (
                this.currentQueueTrack?.tracks.id !== currentSpotifyTrack.id
              ) {
                const nextInQueue = queueManager.getNextTrack()
                if (
                  nextInQueue &&
                  nextInQueue.tracks.id === currentSpotifyTrack.id
                ) {
                  this.log(
                    'INFO',
                    `Synced playing track with queue: ${nextInQueue.id}`
                  )
                  this.currentQueueTrack = nextInQueue
                }
              }
            }

            this.lastKnownState = state

            // --- State Transformation for UI ---
            const transformedState = {
              item: state.track_window?.current_track
                ? {
                    id: state.track_window.current_track.id,
                    name: state.track_window.current_track.name,
                    uri: state.track_window.current_track.uri,
                    duration_ms: state.track_window.current_track.duration_ms,
                    artists: state.track_window.current_track.artists.map(
                      (artist: any) => ({
                        name: artist.name
                      })
                    ),
                    album: {
                      name: state.track_window.current_track.album.name
                    }
                  }
                : null,
              is_playing: !state.paused,
              progress_ms: state.position,
              duration_ms: state.duration
            }
            onPlaybackStateChange(transformedState)
          })()
        })

        // Connect to Spotify
        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify')
        }

        // Store player instance
        this.playerRef = player
        window.spotifyPlayerInstance = player

        // Set up cleanup timeout
        this.cleanupTimeoutRef = setTimeout(
          () => {
            if (this.playerRef === player) {
              this.log(
                'INFO',
                'Cleanup timeout reached, player may need recovery'
              )
            }
          },
          5 * 60 * 1000
        ) // 5 minutes

        // The promise will be resolved by the 'ready' event
      } catch (error) {
        this.log('ERROR', 'Error creating player', error)
        reject(error)
      }
    })
  }

  destroyPlayer(): void {
    // Clear all timeouts
    if (this.cleanupTimeoutRef) {
      clearTimeout(this.cleanupTimeoutRef)
      this.cleanupTimeoutRef = null
    }
    if (this.notReadyTimeoutRef) {
      clearTimeout(this.notReadyTimeoutRef)
      this.notReadyTimeoutRef = null
    }
    if (this.reconnectionTimeoutRef) {
      clearTimeout(this.reconnectionTimeoutRef)
      this.reconnectionTimeoutRef = null
    }
    if (this.verificationTimeoutRef) {
      clearTimeout(this.verificationTimeoutRef)
      this.verificationTimeoutRef = null
    }

    if (this.playerRef) {
      this.playerRef.disconnect()
      this.playerRef = null
    }

    this.log('INFO', 'Player destroyed')
  }

  getPlayer(): Spotify.Player | null {
    return this.playerRef
  }

  async reloadSDK(): Promise<void> {
    this.log('INFO', 'Reloading Spotify SDK...')

    // Clear existing player reference
    this.playerRef = null

    // Clear global references
    if (typeof window !== 'undefined') {
      window.spotifyPlayerInstance = null
      delete (window as any).Spotify
    }

    // Remove existing SDK script if present
    const existingScript = document.querySelector(
      'script[src*="spotify-player.js"]'
    )
    if (existingScript) {
      existingScript.remove()
      this.log('INFO', 'Removed existing Spotify SDK script')
    }

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Reload the SDK script
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Window not available'))
        return
      }

      // Set up the ready callback
      const originalReady = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.log('INFO', 'Spotify SDK reloaded successfully')
        if (originalReady) {
          originalReady()
        }
        resolve()
      }

      // Set up error callback
      const originalError = window.onSpotifyWebPlaybackSDKError
      window.onSpotifyWebPlaybackSDKError = (error: any) => {
        this.log('ERROR', 'Failed to reload Spotify SDK', error)
        if (originalError) {
          originalError(error)
        }
        reject(new Error(`SDK reload failed: ${error}`))
      }

      // Load the SDK script
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.onerror = () => {
        this.log('ERROR', 'Failed to load Spotify SDK script')
        reject(new Error('Failed to load Spotify SDK script'))
      }

      document.body.appendChild(script)

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('SDK reload timeout'))
      }, 10000)
    })
  }
}

// Export singleton instance
export const playerLifecycleService = new PlayerLifecycleService()
