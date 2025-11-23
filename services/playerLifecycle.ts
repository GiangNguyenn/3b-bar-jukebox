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
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import {
  requiresUserAction,
  getUserFriendlyErrorMessage
} from '@/recovery/tokenRecovery'

// Type for internal SDK state tracking - composed instead of extended
// to properly represent the actual SDK state structure
interface PlayerSDKState {
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
    } | null
  }
  disallows?: {
    pausing: boolean
    peeking_next: boolean
    peeking_prev: boolean
    resuming: boolean
    seeking: boolean
    skipping_next: boolean
    skipping_prev: boolean
  }
}

// Type guard for runtime validation of PlayerSDKState
function isPlayerSDKState(state: unknown): state is PlayerSDKState {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  const paused = s.paused
  const position = s.position
  const duration = s.duration
  const trackWindow = s.track_window
  return (
    typeof paused === 'boolean' &&
    typeof position === 'number' &&
    typeof duration === 'number' &&
    trackWindow !== null &&
    trackWindow !== undefined &&
    typeof trackWindow === 'object' &&
    'current_track' in trackWindow
  )
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
  private duplicateDetector: TrackDuplicateDetector =
    new TrackDuplicateDetector()
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
    this.currentQueueTrack = queueManager.getNextTrack() ?? null
  }

  private async checkAndAutoFillQueue(): Promise<void> {
    const queue = queueManager.getQueue()

    if (queue.length <= PLAYER_LIFECYCLE_CONFIG.QUEUE_LOW_THRESHOLD) {
      // Auto-fill will be handled by AutoPlayService
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

    // Always transfer playback to the app's device before playing
    const transferred = await transferPlaybackToDevice(this.deviceId)
    if (!transferred) {
      this.log(
        'ERROR',
        `Failed to transfer playback to app device: ${this.deviceId}. Cannot play next track.`
      )
      return
    }

    // Defensive check: verify we're not about to play a track that's already playing
    // This is a final safety net to catch edge cases where all other protections failed
    try {
      const { sendApiRequest } = await import('@/shared/api')
      const currentPlaybackState = await sendApiRequest<{
        item?: { id: string; name: string }
        is_playing: boolean
      }>({
        path: 'me/player',
        method: 'GET'
      })

      if (
        currentPlaybackState?.item &&
        currentPlaybackState.item.id === track.tracks.spotify_track_id &&
        currentPlaybackState.is_playing
      ) {
        this.log(
          'WARN',
          `Track ${track.tracks.name} (${track.tracks.spotify_track_id}) is already playing. Skipping playback to prevent duplicate.`
        )
        return
      }
    } catch (apiError) {
      // If we can't verify, log warning but continue with playback
      this.log(
        'WARN',
        'Failed to verify current playback state before playing next track, continuing anyway',
        apiError
      )
    }

    const trackUri = `spotify:track:${track.tracks.spotify_track_id}`

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
      } else {
        this.currentQueueTrack = null
      }
    } catch (error) {
      this.log('ERROR', 'Error handling restriction violated error', error)
    }
  }

  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    return new Promise((resolve) => {
      // Clear any existing timeout first
      if (this.verificationTimeoutRef) {
        clearTimeout(this.verificationTimeoutRef)
        this.verificationTimeoutRef = null
      }

      const timeout = setTimeout(() => {
        this.log('WARN', 'Device verification timed out')
        this.verificationTimeoutRef = null
        resolve(false)
      }, PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.verificationTimeout)

      this.verificationTimeoutRef = timeout

      validateDevice(deviceId)
        .then((result) => {
          clearTimeout(timeout)
          this.verificationTimeoutRef = null
          resolve(result.isValid && !(result.device?.isRestricted ?? false))
        })
        .catch((error) => {
          clearTimeout(timeout)
          this.verificationTimeoutRef = null
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
    const currentTrack = state.track_window?.current_track

    // Early return with proper null handling
    if (!currentTrack?.id) {
      this.log('WARN', 'Track finished but no track ID available')
      return
    }

    const currentSpotifyTrackId = currentTrack.id

    // Use shared duplicate detector
    if (!this.duplicateDetector.shouldProcessTrack(currentSpotifyTrackId)) {
      // Still update the last known track even if we're not processing
      // This keeps the detector in sync with actual playback state
      this.duplicateDetector.setLastKnownPlayingTrack(currentSpotifyTrackId)
      return
    }

    const queue = queueManager.getQueue()
    const finishedQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === currentSpotifyTrackId
    )

    if (finishedQueueItem) {
      try {
        await queueManager.markAsPlayed(finishedQueueItem.id)
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

    // Strengthen duplicate detection: validate that next track is not the same as finished track
    // Try limited retries, then fall back to an alternative track instead of pausing playback
    let duplicateRemovalAttempts = 0
    const maxDuplicateRemovalAttempts = 3

    while (
      nextTrack &&
      nextTrack.tracks.spotify_track_id === currentSpotifyTrackId &&
      duplicateRemovalAttempts < maxDuplicateRemovalAttempts
    ) {
      duplicateRemovalAttempts++

      this.log(
        'ERROR',
        `Next track matches finished track (${currentSpotifyTrackId}) - queue sync issue detected. Attempting to remove duplicate (attempt ${duplicateRemovalAttempts}/${maxDuplicateRemovalAttempts}).`
      )

      try {
        await queueManager.markAsPlayed(nextTrack.id)
        this.log(
          'INFO',
          `Successfully removed duplicate track on retry: ${nextTrack.id}`
        )

        // Get next track again
        nextTrack = queueManager.getNextTrack()

        // If we successfully removed it and got a different track, break
        if (
          !nextTrack ||
          nextTrack.tracks.spotify_track_id !== currentSpotifyTrackId
        ) {
          break
        }
      } catch (retryError) {
        this.log(
          'ERROR',
          `Failed to remove duplicate track on attempt ${duplicateRemovalAttempts}`,
          retryError
        )

        // On final failure, break out and try an alternative instead of forcing a pause
        if (duplicateRemovalAttempts >= maxDuplicateRemovalAttempts) {
          break
        }
      }
    }

    // Final validation: if next track STILL matches finished track after all attempts,
    // prefer an alternative track over pausing playback, falling back to pause only
    // when no safe alternative exists.
    if (
      nextTrack &&
      nextTrack.tracks.spotify_track_id === currentSpotifyTrackId
    ) {
      const alternativeTrack = queueManager.getTrackAfterNext()

      if (
        alternativeTrack &&
        alternativeTrack.tracks.spotify_track_id !== currentSpotifyTrackId
      ) {
        this.log(
          'WARN',
          `Next track still matches finished track (${currentSpotifyTrackId}) after ${duplicateRemovalAttempts} attempts, but an alternative is available. Switching to alternative track ${alternativeTrack.id} instead of pausing playback.`
        )
        nextTrack = alternativeTrack
      } else {
        this.log(
          'ERROR',
          `Next track STILL matches finished track after ${maxDuplicateRemovalAttempts} removal attempts and no safe alternative exists. Refusing to play duplicate. Pausing playback.`
        )
        nextTrack = undefined

        // Pause playback to prevent playing the same track again
        if (this.deviceId) {
          try {
            const SpotifyApiService = (await import('@/services/spotifyApi'))
              .SpotifyApiService
            await SpotifyApiService.getInstance().pausePlayback(this.deviceId)
          } catch (pauseError) {
            this.log(
              'ERROR',
              'Failed to pause playback after duplicate detection',
              pauseError
            )
          }
        }
      }
    }

    if (nextTrack) {
      this.currentQueueTrack = nextTrack

      // Play the next track immediately using SDK event (0ms delay)
      await this.playNextTrack(nextTrack)
    } else {
      this.currentQueueTrack = null
    }
  }

  private syncQueueWithPlayback(state: PlayerSDKState): void {
    const currentSpotifyTrack = state.track_window?.current_track

    // Update duplicate detector when a new track starts playing
    // This prevents the guard from blocking legitimate track-finished events
    // if the same song plays again (e.g., due to queue sync issues or failed operations)
    if (currentSpotifyTrack) {
      const currentTrackId = currentSpotifyTrack.id
      const lastKnownId = this.duplicateDetector.getLastKnownPlayingTrackId()

      // If track changed, reset processed flag but keep track of new track
      if (lastKnownId !== currentTrackId) {
        // Use the setter to update without processing
        this.duplicateDetector.setLastKnownPlayingTrack(currentTrackId)
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
        this.currentQueueTrack = matchingQueueItem
      } else if (!matchingQueueItem && this.currentQueueTrack) {
        this.currentQueueTrack = null
      } else if (
        !matchingQueueItem &&
        !this.currentQueueTrack &&
        queue.length > 0
      ) {
        const firstInQueue = queue[0]
        this.currentQueueTrack = firstInQueue
      }
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

    const lastTrack = this.lastKnownState.track_window?.current_track
    const currentTrack = state.track_window?.current_track

    // Both tracks must exist to compare
    if (!lastTrack || !currentTrack) {
      return false
    }

    const trackJustFinished =
      !this.lastKnownState.paused &&
      state.paused &&
      state.position === 0 &&
      lastTrack.uri === currentTrack.uri

    const isNearEnd =
      state.duration > 0 &&
      state.duration - state.position <
        PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS

    const hasStalled =
      !this.lastKnownState.paused &&
      state.paused &&
      state.position === this.lastKnownState.position &&
      lastTrack.uri === currentTrack.uri

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
      // Only call callback if we have a valid state
      // transformStateForUI returns SpotifyPlaybackState | null, but callback expects SpotifyPlaybackState
      // This guard ensures we never pass null, maintaining the callback's type contract
      if (transformedState) {
        onPlaybackStateChange(transformedState)
      }
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
        `Authentication failed after ${this.authRetryCount} attempts. Please reconnect your Spotify account.`
      )
      return
    }

    this.authRetryCount++

    try {
      tokenManager.clearCache()

      // Attempt to get a fresh token (this will use the recovery logic in API endpoints)
      const token = await tokenManager.getToken()

      if (!token) {
        throw new Error('Failed to obtain token after refresh')
      }

      onStatusChange(
        'initializing',
        `Refreshing authentication (attempt ${this.authRetryCount}/${PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS})`
      )

      this.destroyPlayer()
      await this.createPlayer(
        onStatusChange,
        onDeviceIdChange,
        onPlaybackStateChange
      )

      // Reset retry count on success
      this.authRetryCount = 0
    } catch (error) {
      this.log('ERROR', 'Failed to recover from authentication error', error)

      // Check if error indicates user action is required
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const needsUserAction =
        errorMessage.includes('INVALID_REFRESH_TOKEN') ||
        errorMessage.includes('INVALID_CLIENT_CREDENTIALS') ||
        errorMessage.includes('NO_REFRESH_TOKEN')

      if (needsUserAction) {
        onStatusChange(
          'error',
          'Please reconnect your Spotify account to continue playback.'
        )
      } else {
        // For recoverable errors, show retry message
        onStatusChange(
          'error',
          `Authentication error (attempt ${this.authRetryCount}/${PLAYER_LIFECYCLE_CONFIG.MAX_AUTH_RETRY_ATTEMPTS}). Retrying...`
        )
      }
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

        // Runtime validation instead of unsafe type assertion
        if (!isPlayerSDKState(state)) {
          this.log(
            'ERROR',
            'Invalid state shape received in player_state_changed',
            new Error('Invalid state structure')
          )
          return
        }

        void this.handlePlayerStateChanged(state, onPlaybackStateChange)
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
      // Store cleanup function to prevent memory leaks
      let cleanup: (() => void) | null = null

      return new Promise<string>((resolve, reject) => {
        const readyHandler = (event: { device_id: string }) => {
          cleanup?.() // Remove listeners to prevent memory leaks
          resolve(event.device_id)
        }
        const errorHandler = (event: { message: string }) => {
          cleanup?.() // Remove listeners to prevent memory leaks
          reject(new Error(event.message))
        }

        player.addListener('ready', readyHandler)
        player.addListener('initialization_error', errorHandler)

        // Store cleanup function
        cleanup = () => {
          player.removeListener('ready', readyHandler)
          player.removeListener('initialization_error', errorHandler)
        }
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
    this.duplicateDetector.reset()
    this.authRetryCount = 0
  }

  getPlayer(): Spotify.Player | null {
    return this.playerRef
  }

  async reloadSDK(): Promise<void> {
    this.playerRef = null

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

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const originalReady = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = () => {
        cleanup() // Clear timeout if script loads successfully
        if (originalReady) {
          originalReady()
        }
        if (!isResolved) {
          isResolved = true
          resolve()
        }
      }

      const originalError = window.onSpotifyWebPlaybackSDKError
      window.onSpotifyWebPlaybackSDKError = (error: unknown) => {
        cleanup() // Clear timeout on error
        this.log('ERROR', 'Failed to reload Spotify SDK', error)
        if (originalError) {
          originalError(error)
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
        cleanup() // Clear timeout on script error
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
}

// Export singleton instance
export const playerLifecycleService = new PlayerLifecycleService()
