import { sendApiRequest } from '@/shared/api'
import {
  validateDevice,
  transferPlaybackToDevice,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import {
  SpotifySDKPlaybackState,
  SpotifyPlaybackState
} from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'
import { PLAYER_LIFECYCLE_CONFIG } from './playerLifecycleConfig'

// Extended type for internal SDK state tracking
interface PlayerSDKState extends SpotifySDKPlaybackState {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: {
      id: string
      uri: string
      name: string
      artists: Array<{ name: string }>
      album: {
        name: string
        images: Array<{ url: string }>
      }
      duration_ms: number
    }
  }
}

// Type for the navigation callback
export type NavigationCallback = (path: string) => void

// Player lifecycle management service
class PlayerLifecycleService {
  private playerRef: Spotify.Player | null = null
  private lastKnownState: PlayerSDKState | null = null
  private currentQueueTrack: JukeboxQueueItem | null = null
  private deviceId: string | null = null
  private cleanupTimeoutRef: NodeJS.Timeout | null = null
  private notReadyTimeoutRef: NodeJS.Timeout | null = null
  private reconnectionTimeoutRef: NodeJS.Timeout | null = null
  private verificationTimeoutRef: NodeJS.Timeout | null = null
  private authRetryCount: number = 0
  private lastProcessedTrackId: string | null = null
  private lastKnownPlayingTrackId: string | null = null
  private addLog:
    | ((
        level: LogLevel,
        message: string,
        context?: string,
        error?: Error
      ) => void)
    | null = null
  private navigationCallback: NavigationCallback | null = null

  setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ): void {
    this.addLog = logger
  }

  setNavigationCallback(callback: NavigationCallback): void {
    this.navigationCallback = callback
  }

  async initializeQueue(playlistId: string): Promise<void> {
    this.log('INFO', `Initializing queue with playlist ID: ${playlistId}`)
    this.currentQueueTrack = queueManager.getNextTrack() ?? null
  }

  private async checkAndAutoFillQueue(): Promise<void> {
    const queue = queueManager.getQueue()

    if (queue.length <= PLAYER_LIFECYCLE_CONFIG.QUEUE_LOW_THRESHOLD) {
      this.log(
        'INFO',
        `Queue is low (${queue.length} tracks remaining), triggering auto-fill`
      )

      this.log(
        'INFO',
        `Auto-fill needed but will be handled by AutoPlayService (no username context here)`
      )
    }
  }

  private log(level: LogLevel, message: string, error?: unknown): void {
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

  private async playTrackWithRetry(
    trackUri: string,
    deviceId: string,
    maxRetries = 3
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.log(
          'INFO',
          `Playing track ${trackUri} on device ${deviceId} (attempt ${attempt + 1}/${maxRetries + 1})`
        )

        await sendApiRequest({
          path: `me/player/play?device_id=${deviceId}`,
          method: 'PUT',
          body: {
            uris: [trackUri]
          }
        })

        this.log('INFO', `Successfully started playback for ${trackUri}`)
        return true
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        // Handle "Restriction violated" by skipping to next track
        if (errorMessage.includes('Restriction violated')) {
          this.log(
            'WARN',
            `Restriction violated for track ${trackUri}, skipping to next track`
          )
          return false // Don't retry, just skip this track
        }

        // If we've exhausted retries, fail
        if (attempt === maxRetries) {
          this.log(
            'ERROR',
            `Failed to play track ${trackUri} after ${maxRetries + 1} attempts`,
            error
          )
          return false
        }

        // Exponential backoff: 500ms, 1000ms, 2000ms
        const backoffMs = 500 * Math.pow(2, attempt)
        this.log(
          'WARN',
          `Playback attempt ${attempt + 1} failed, retrying in ${backoffMs}ms`,
          error
        )
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }
    return false
  }

  private async playNextTrack(track: JukeboxQueueItem): Promise<void> {
    if (!this.deviceId) {
      this.log('ERROR', 'No device ID available to play next track')
      return
    }

    const trackUri = `spotify:track:${track.tracks.spotify_track_id}`
    this.log(
      'INFO',
      `Starting next track: ${track.tracks.name} by ${track.tracks.artist}`
    )

    const success = await this.playTrackWithRetry(trackUri, this.deviceId, 3)

    if (!success) {
      this.log(
        'WARN',
        `Failed to play track ${track.tracks.name}, trying next track in queue`
      )

      // Remove the problematic track from queue
      try {
        await queueManager.markAsPlayed(track.id)
      } catch (error) {
        this.log(
          'ERROR',
          'Failed to remove problematic track from queue',
          error
        )
      }

      // Try to play the next track recursively
      const nextTrack = queueManager.getNextTrack()
      if (nextTrack) {
        await this.playNextTrack(nextTrack)
      } else {
        this.log('INFO', 'No more tracks available in queue')
      }
    }
  }

  private async handleRestrictionViolatedError(): Promise<void> {
    try {
      const currentTrack = this.currentQueueTrack
      if (!currentTrack) {
        this.log(
          'WARN',
          'No current track found, cannot remove problematic track'
        )
        return
      }

      await queueManager.markAsPlayed(currentTrack.id)

      const nextTrack = queueManager.getNextTrack()

      if (nextTrack) {
        this.currentQueueTrack = nextTrack
        this.log(
          'INFO',
          `Next track ready after restriction error: ${nextTrack.tracks.name} (AutoPlayService will handle playback)`
        )
      } else {
        this.currentQueueTrack = null
        this.log('INFO', 'No more tracks in queue after restriction error')
      }
    } catch (error) {
      this.log('ERROR', 'Error handling restriction violated error', error)
    }
  }

  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.log('WARN', 'Device verification timed out')
        resolve(false)
      }, PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.verificationTimeout)

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

  private async handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ): Promise<void> {
    this.log('WARN', `Device ${deviceId} reported as not ready`)

    if (this.notReadyTimeoutRef) {
      clearTimeout(this.notReadyTimeoutRef)
    }

    this.notReadyTimeoutRef = setTimeout(async () => {
      onStatusChange('reconnecting')

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

      onStatusChange('error', 'Device transfer failed')
    }, PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.notReadyToReconnecting)
  }

  private async handleTrackFinished(state: PlayerSDKState): Promise<void> {
    const currentSpotifyTrackId = state.track_window?.current_track?.id

    // Prevent duplicate processing
    if (this.lastProcessedTrackId === currentSpotifyTrackId) {
      return
    }

    this.lastProcessedTrackId = currentSpotifyTrackId

    this.log(
      'INFO',
      `Track finished detected for Spotify track ID: ${currentSpotifyTrackId}`
    )

    const queue = queueManager.getQueue()
    const finishedQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === currentSpotifyTrackId
    )

    if (finishedQueueItem) {
      this.log(
        'INFO',
        `Found queue item for finished track: ${finishedQueueItem.id}`
      )

      try {
        await queueManager.markAsPlayed(finishedQueueItem.id)
        this.log('INFO', `Marked queue item ${finishedQueueItem.id} as played`)
      } catch (error) {
        this.log(
          'WARN',
          `Failed to mark queue item ${finishedQueueItem.id} as played`,
          error
        )
      }
    } else {
      this.log(
        'WARN',
        `No queue item found for finished track: ${currentSpotifyTrackId}. Track may have been manually started or already removed from queue.`
      )
    }

    await this.checkAndAutoFillQueue()

    let nextTrack = queueManager.getNextTrack()

    // Validate that the next track is not the same as the finished track
    if (
      nextTrack &&
      nextTrack.tracks.spotify_track_id === currentSpotifyTrackId
    ) {
      this.log(
        'ERROR',
        `Next track matches finished track (${currentSpotifyTrackId}) - queue sync issue detected. Attempting to remove duplicate.`
      )

      try {
        await queueManager.markAsPlayed(nextTrack.id)
        this.log(
          'INFO',
          `Successfully removed duplicate track on retry: ${nextTrack.id}`
        )
        nextTrack = queueManager.getNextTrack()
      } catch (retryError) {
        this.log(
          'ERROR',
          'Failed to remove duplicate track on retry',
          retryError
        )
        nextTrack = undefined
      }
    }

    if (nextTrack) {
      this.log(
        'INFO',
        `Next track in queue: ${nextTrack.tracks.name}, starting playback immediately`
      )
      this.currentQueueTrack = nextTrack

      // Play the next track immediately using SDK event (0ms delay)
      await this.playNextTrack(nextTrack)
    } else {
      this.log('INFO', 'Queue is empty. Playback will stop.')
      this.currentQueueTrack = null
    }
  }

  private syncQueueWithPlayback(state: PlayerSDKState): void {
    const currentSpotifyTrack = state.track_window?.current_track
    
    // Reset lastProcessedTrackId when a new track starts playing
    // This prevents the guard from blocking legitimate track-finished events
    // if the same song plays again (e.g., due to queue sync issues or failed operations)
    if (currentSpotifyTrack) {
      const currentTrackId = currentSpotifyTrack.id
      if (this.lastKnownPlayingTrackId !== currentTrackId) {
        if (this.lastKnownPlayingTrackId) {
          this.log(
            'INFO',
            `Track changed from ${this.lastKnownPlayingTrackId} to ${currentTrackId}, resetting track processing guard`
          )
        }
        this.lastProcessedTrackId = null
        this.lastKnownPlayingTrackId = currentTrackId
      }
    }
    
    if (currentSpotifyTrack && !state.paused) {
      const queue = queueManager.getQueue()
      const matchingQueueItem = queue.find(
        (item) => item.tracks.spotify_track_id === currentSpotifyTrack.id
      )

      if (
        matchingQueueItem &&
        this.currentQueueTrack?.id !== matchingQueueItem.id
      ) {
        this.log(
          'INFO',
          `Synced playing track with queue: ${matchingQueueItem.id} (${matchingQueueItem.tracks.name})`
        )
        this.currentQueueTrack = matchingQueueItem
      } else if (!matchingQueueItem && this.currentQueueTrack) {
        this.log(
          'INFO',
          `Currently playing track ${currentSpotifyTrack.id} not found in queue (expected during transitions)`
        )
        this.currentQueueTrack = null
      } else if (
        !matchingQueueItem &&
        !this.currentQueueTrack &&
        queue.length > 0
      ) {
        const firstInQueue = queue[0]
        this.log(
          'INFO',
          `Music playing but track not matched. Assuming queue[0] is playing: ${firstInQueue.tracks.name} (${firstInQueue.tracks.spotify_track_id})`
        )
        this.currentQueueTrack = firstInQueue
      }
    }
  }

  private transformStateForUI(state: PlayerSDKState): SpotifyPlaybackState {
    return {
      item: state.track_window?.current_track
        ? {
            id: state.track_window.current_track.id,
            name: state.track_window.current_track.name,
            uri: state.track_window.current_track.uri,
            duration_ms: state.track_window.current_track.duration_ms,
            artists: state.track_window.current_track.artists.map((artist) => ({
              name: artist.name
            })),
            album: {
              name: state.track_window.current_track.album.name,
              images: state.track_window.current_track.album.images
            }
          }
        : ({} as SpotifyPlaybackState['item']),
      is_playing: !state.paused,
      progress_ms: state.position,
      timestamp: Date.now(),
      context: { uri: '' },
      device: {
        id: this.deviceId ?? '',
        is_active: true,
        is_private_session: false,
        is_restricted: false,
        name: 'Jukebox Player',
        type: 'Computer',
        volume_percent: 50
      }
    }
  }

  private isTrackFinished(state: PlayerSDKState): boolean {
    if (!this.lastKnownState) {
      return false
    }

    const trackJustFinished =
      !this.lastKnownState.paused &&
      state.paused &&
      state.position === 0 &&
      this.lastKnownState.track_window.current_track?.uri ===
        state.track_window.current_track?.uri

    const isNearEnd =
      state.duration > 0 &&
      state.duration - state.position <
        PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS

    const hasStalled =
      !this.lastKnownState.paused &&
      state.paused &&
      state.position === this.lastKnownState.position &&
      this.lastKnownState.track_window.current_track?.uri ===
        state.track_window.current_track?.uri

    return trackJustFinished || (isNearEnd && hasStalled)
  }

  private async handlePlayerStateChanged(
    state: PlayerSDKState,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<void> {
    try {
      if (this.isTrackFinished(state)) {
        await this.handleTrackFinished(state)
      }

      this.syncQueueWithPlayback(state)
      this.lastKnownState = state

      const transformedState = this.transformStateForUI(state)
      onPlaybackStateChange(transformedState)
    } catch (error) {
      this.log('ERROR', 'Error in player state changed handler', error)
    }
  }

  private async handleAuthenticationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<void> {
    this.log('ERROR', `Failed to authenticate: ${message}`)

    if (
      this.authRetryCount >= PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS
    ) {
      this.log(
        'ERROR',
        `Authentication retry limit reached (${this.authRetryCount} attempts)`
      )
      onStatusChange(
        'error',
        `Authentication failed after ${this.authRetryCount} attempts`
      )
      return
    }

    this.authRetryCount++

    try {
      tokenManager.clearCache()
      await tokenManager.getToken()

      onStatusChange(
        'initializing',
        `Refreshing authentication (attempt ${this.authRetryCount})`
      )

      this.destroyPlayer()
      await this.createPlayer(
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )
    } catch (error) {
      this.log('ERROR', 'Failed to recover from authentication error', error)
      onStatusChange('error', `Authentication error: ${message}`)
    }
  }

  private handleAccountError(message: string): void {
    this.log('ERROR', `Account error: ${message}`)

    const isPremiumError =
      message.toLowerCase().includes('premium') ||
      message.toLowerCase().includes('subscription') ||
      message.toLowerCase().includes('not available') ||
      message.toLowerCase().includes('upgrade')

    if (isPremiumError) {
      if (this.navigationCallback) {
        this.navigationCallback('/premium-required')
      } else {
        // Fallback to direct navigation if callback not set
        this.log(
          'WARN',
          'Navigation callback not set, using window.location.href as fallback'
        )
        window.location.href = '/premium-required'
      }
    }
  }

  private clearAllTimeouts(): void {
    const timeouts = [
      this.cleanupTimeoutRef,
      this.notReadyTimeoutRef,
      this.reconnectionTimeoutRef,
      this.verificationTimeoutRef
    ]

    timeouts.forEach((timeout) => {
      if (timeout) {
        clearTimeout(timeout)
      }
    })

    this.cleanupTimeoutRef = null
    this.notReadyTimeoutRef = null
    this.reconnectionTimeoutRef = null
    this.verificationTimeoutRef = null
  }

  async createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState) => void
  ): Promise<string> {
    // Check preconditions
    if (this.playerRef) {
      throw new Error('Player already exists')
    }

    if (typeof window.Spotify === 'undefined') {
      this.log('ERROR', 'Spotify SDK not loaded')
      onStatusChange('error', 'Spotify SDK not loaded')
      throw new Error('Spotify SDK not loaded')
    }

    try {
      // Set up device management logger
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

      // Clear any existing cleanup timeout
      if (this.cleanupTimeoutRef) {
        clearTimeout(this.cleanupTimeoutRef)
      }

      onStatusChange('initializing')

      const player = new window.Spotify.Player({
        name: 'Jukebox Player',
        getOAuthToken: (cb) => {
          tokenManager
            .getToken()
            .then((token) => cb(token))
            .catch((error) => {
              this.log('ERROR', 'Error getting token from token manager', error)
              throw error
            })
        },
        volume: 0.5
      })

      // Set up event listeners
      player.addListener('ready', async ({ device_id }) => {
        if (this.notReadyTimeoutRef) {
          clearTimeout(this.notReadyTimeoutRef)
        }

        onStatusChange('verifying')

        const deviceVerified = await this.verifyDeviceWithTimeout(device_id)
        if (!deviceVerified) {
          this.log(
            'WARN',
            'Device setup verification failed, but proceeding anyway'
          )
        }

        this.deviceId = device_id
        onDeviceIdChange(device_id)

        const transferSuccess = await transferPlaybackToDevice(device_id)
        if (!transferSuccess) {
          this.log('ERROR', 'Failed to transfer playback to new device')
          onStatusChange('error', 'Failed to transfer playback')
          return
        }

        onStatusChange('ready')
        // Reset auth retry count on successful connection
        this.authRetryCount = 0
      })

      player.addListener('not_ready', (event) => {
        void this.handleNotReady(event.device_id, onStatusChange)
      })

      player.addListener('initialization_error', ({ message }) => {
        this.log('ERROR', `Failed to initialize: ${message}`)
        onStatusChange('error', `Initialization error: ${message}`)
      })

      player.addListener('authentication_error', ({ message }) => {
        void this.handleAuthenticationError(
          message,
          onStatusChange,
          onDeviceIdChange,
          onPlaybackStateChange
        )
      })

      player.addListener('account_error', ({ message }) => {
        this.handleAccountError(message)
        onStatusChange('error', `Account error: ${message}`)
      })

      player.addListener('playback_error', ({ message }) => {
        this.log('ERROR', `Playback error: ${message}`)

        if (message.includes('Restriction violated')) {
          this.log(
            'WARN',
            'Restriction violated error detected - removing problematic track and playing next'
          )
          void this.handleRestrictionViolatedError()
        } else {
          this.log(
            'WARN',
            'Playback error occurred, but error handling is managed by health monitor'
          )
        }
      })

      player.addListener('player_state_changed', (state) => {
        if (!state) {
          this.log(
            'WARN',
            'Received null state in player_state_changed event. Device is likely inactive.'
          )
          onStatusChange('reconnecting', 'Device became inactive')
          return
        }

        void this.handlePlayerStateChanged(
          state as PlayerSDKState,
          onPlaybackStateChange
        )
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
      this.cleanupTimeoutRef = setTimeout(() => {
        if (this.playerRef === player) {
          this.log(
            'INFO',
            'Cleanup timeout reached, player may need reinitialization'
          )
        }
      }, PLAYER_LIFECYCLE_CONFIG.CLEANUP_TIMEOUT_MS)

      // Return device ID when ready event fires
      return new Promise<string>((resolve, reject) => {
        const readyHandler = (event: { device_id: string }) => {
          resolve(event.device_id)
        }
        const errorHandler = (event: { message: string }) => {
          reject(new Error(event.message))
        }

        player.addListener('ready', readyHandler)
        player.addListener('initialization_error', errorHandler)
      })
    } catch (error) {
      this.clearAllTimeouts()
      this.log('ERROR', 'Error creating player', error)
      throw error
    }
  }

  destroyPlayer(): void {
    this.clearAllTimeouts()

    if (this.playerRef) {
      this.playerRef.disconnect()
      this.playerRef = null
    }

    // Reset state
    this.lastProcessedTrackId = null
    this.lastKnownPlayingTrackId = null
    this.authRetryCount = 0

    this.log('INFO', 'Player destroyed')
  }

  getPlayer(): Spotify.Player | null {
    return this.playerRef
  }

  async reloadSDK(): Promise<void> {
    this.log('INFO', 'Reloading Spotify SDK...')

    this.playerRef = null

    if (typeof window !== 'undefined') {
      window.spotifyPlayerInstance = null
    }

    const existingScript = document.querySelector(
      'script[src*="spotify-player.js"]'
    )
    if (existingScript) {
      existingScript.remove()
      this.log('INFO', 'Removed existing Spotify SDK script')
    }

    await new Promise((resolve) => setTimeout(resolve, 100))

    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Window not available'))
        return
      }

      const originalReady = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.log('INFO', 'Spotify SDK reloaded successfully')
        if (originalReady) {
          originalReady()
        }
        resolve()
      }

      const originalError = window.onSpotifyWebPlaybackSDKError
      window.onSpotifyWebPlaybackSDKError = (error: unknown) => {
        this.log('ERROR', 'Failed to reload Spotify SDK', error)
        if (originalError) {
          originalError(error)
        }
        reject(new Error(`SDK reload failed: ${String(error)}`))
      }

      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.onerror = () => {
        this.log('ERROR', 'Failed to load Spotify SDK script')
        reject(new Error('Failed to load Spotify SDK script'))
      }

      document.body.appendChild(script)

      setTimeout(() => {
        reject(new Error('SDK reload timeout'))
      }, PLAYER_LIFECYCLE_CONFIG.SDK_RELOAD_TIMEOUT_MS)
    })
  }
}

// Export singleton instance
export const playerLifecycleService = new PlayerLifecycleService()
