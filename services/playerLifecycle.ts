import { sendApiRequest } from '@/shared/api'
import {
  validateDevice,
  transferPlaybackToDevice,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { upsertPlayedTrack } from '@/lib/trackUpsert'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'
import { PLAYER_LIFECYCLE_CONFIG } from './playerLifecycleConfig'
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import { buildTrackUri } from '@/shared/utils/spotifyUri'
import {
  ensureTrackNotDuplicate,
  withErrorHandling,
  TimeoutManager
} from './playerLifecycle/utils'

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
  private timeoutManager: TimeoutManager = new TimeoutManager()
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

  initializeQueue(): void {
    this.currentQueueTrack = queueManager.getNextTrack() ?? null
  }

  private checkAndAutoFillQueue(): void {
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

    // Iterative approach: try tracks from queue until success or exhaustion
    const MAX_ATTEMPTS = 10 // Safety limit to prevent infinite loops
    let currentTrack: JukeboxQueueItem | null = track
    let attempts = 0
    let lastPlayingTrackId: string | null = null

    // Get current playing track ID for duplicate detection
    try {
      const playbackState = await sendApiRequest<{
        item?: { id: string }
      }>({
        path: 'me/player',
        method: 'GET'
      })
      lastPlayingTrackId = playbackState?.item?.id ?? null
    } catch (error) {
      // If we can't get playback state, continue anyway
      this.log(
        'WARN',
        'Failed to get current playback state for duplicate detection, continuing anyway',
        error
      )
    }

    while (currentTrack && attempts < MAX_ATTEMPTS) {
      attempts++

      this.log(
        'INFO',
        `[playNextTrack] Attempt ${attempts}/${MAX_ATTEMPTS} - Track: ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id}), Queue ID: ${currentTrack.id}`
      )

      // Check for duplicate if we have last playing track ID
      if (lastPlayingTrackId) {
        const validTrack = await ensureTrackNotDuplicate(
          currentTrack,
          lastPlayingTrackId,
          3,
          this.addLog ?? undefined
        )

        if (!validTrack) {
          this.log(
            'WARN',
            `Track ${currentTrack.tracks.name} is a duplicate, queue exhausted or removal failed`
          )
          break
        }

        currentTrack = validTrack
      }

      // Transfer playback to device
      const transferred = await transferPlaybackToDevice(this.deviceId)

      if (!transferred) {
        this.log(
          'ERROR',
          `Failed to transfer playback to device ${this.deviceId}. Cannot play track.`
        )
        // Try next track in queue
        await withErrorHandling(
          async () => {
            await queueManager.markAsPlayed(currentTrack!.id)
          },
          '[playNextTrack] Remove track after transfer failure',
          this.addLog ?? undefined
        )
        currentTrack = queueManager.getNextTrack() ?? null
        continue
      }

      // Build track URI and attempt playback
      const trackUri = buildTrackUri(currentTrack.tracks.spotify_track_id)

      this.log(
        'INFO',
        `[playNextTrack] Attempting to play track URI: ${trackUri} on device: ${this.deviceId}`
      )

      const success = await this.playTrackWithRetry(trackUri, this.deviceId, 3)

      if (success) {
        this.log(
          'INFO',
          `[playNextTrack] Successfully started playback of track: ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id})`
        )

        // Upsert track metadata to database (fire-and-forget)
        void upsertPlayedTrack(currentTrack.tracks.spotify_track_id)

        this.currentQueueTrack = currentTrack
        // Update queue manager with currently playing track so getNextTrack() excludes it
        queueManager.setCurrentlyPlayingTrack(
          currentTrack.tracks.spotify_track_id
        )
        return
      }

      // Playback failed - remove track and try next
      this.log(
        'WARN',
        `[playNextTrack] Failed to play track ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id}) after retries. Queue ID: ${currentTrack.id}. Trying next track.`
      )

      await withErrorHandling(
        async () => {
          await queueManager.markAsPlayed(currentTrack!.id)
        },
        '[playNextTrack] Remove failed track',
        this.addLog ?? undefined
      )

      // Get next track from queue
      currentTrack = queueManager.getNextTrack() ?? null
    }

    if (attempts >= MAX_ATTEMPTS) {
      this.log(
        'ERROR',
        `[playNextTrack] Maximum attempts (${MAX_ATTEMPTS}) reached. Stopping track playback attempts.`
      )
    } else if (!currentTrack) {
      this.log('WARN', '[playNextTrack] No more tracks available in queue')
    }
  }

  private async handleRestrictionViolatedError(): Promise<void> {
    const currentTrack = this.currentQueueTrack
    if (!currentTrack) {
      this.log(
        'WARN',
        'No current track found, cannot remove problematic track'
      )
      return
    }

    await withErrorHandling(
      async () => {
        await queueManager.markAsPlayed(currentTrack.id)
        const nextTrack = queueManager.getNextTrack()
        this.currentQueueTrack = nextTrack ?? null
      },
      '[handleRestrictionViolatedError] Remove restricted track',
      this.addLog ?? undefined
    )
  }

  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutKey = 'deviceVerification'

      // Clear any existing timeout first
      this.timeoutManager.clear(timeoutKey)

      const timeout = setTimeout(() => {
        this.log('WARN', 'Device verification timed out')
        this.timeoutManager.clear(timeoutKey)
        resolve(false)
      }, PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.verificationTimeout)

      this.timeoutManager.set(timeoutKey, timeout)

      validateDevice(deviceId)
        .then((result) => {
          this.timeoutManager.clear(timeoutKey)
          resolve(result.isValid && !(result.device?.isRestricted ?? false))
        })
        .catch((error) => {
          this.timeoutManager.clear(timeoutKey)
          this.log('ERROR', 'Device verification failed', error)
          resolve(false)
        })
    })
  }

  private handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ): void {
    this.log('WARN', `Device ${deviceId} reported as not ready`)

    const timeoutKey = 'notReady'
    this.timeoutManager.clear(timeoutKey)

    const timeout = setTimeout(() => {
      void (async () => {
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
      })()
    }, PLAYER_LIFECYCLE_CONFIG.GRACE_PERIODS.notReadyToReconnecting)

    this.timeoutManager.set(timeoutKey, timeout)
  }

  private async markFinishedTrackAsPlayed(
    trackId: string,
    trackName: string
  ): Promise<void> {
    const queue = queueManager.getQueue()
    const finishedQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === trackId
    )

    if (finishedQueueItem) {
      await withErrorHandling(
        async () => {
          this.log(
            'INFO',
            `[markFinishedTrackAsPlayed] Marking queue item as played - Queue ID: ${finishedQueueItem.id}, Track: ${finishedQueueItem.tracks.name}`
          )
          await queueManager.markAsPlayed(finishedQueueItem.id)
          this.log(
            'INFO',
            `[markFinishedTrackAsPlayed] Successfully marked queue item as played: ${finishedQueueItem.id}`
          )
        },
        '[markFinishedTrackAsPlayed] Mark track as played',
        this.addLog ?? undefined
      )
    } else {
      this.log(
        'WARN',
        `[markFinishedTrackAsPlayed] No queue item found for finished track: ${trackId} (${trackName}). Track may have been manually started or already removed from queue. Queue length: ${queue.length}`
      )
    }
  }

  private async findNextValidTrack(
    finishedTrackId: string
  ): Promise<JukeboxQueueItem | null> {
    this.checkAndAutoFillQueue()

    // Get next track - getNextTrack() automatically excludes the currently playing track
    const nextTrack = queueManager.getNextTrack()

    if (!nextTrack) {
      return null
    }

    // Use utility function to ensure track is not a duplicate
    // (shouldn't be needed with excludeTrackId, but keep as safety check)
    const validTrack = await ensureTrackNotDuplicate(
      nextTrack,
      finishedTrackId,
      3,
      this.addLog ?? undefined
    )

    if (!validTrack) {
      // If duplicate removal failed, try alternative track
      const alternativeTrack = queueManager.getTrackAfterNext()
      if (
        alternativeTrack &&
        alternativeTrack.tracks.spotify_track_id !== finishedTrackId
      ) {
        this.log(
          'WARN',
          `[findNextValidTrack] Using alternative track ${alternativeTrack.id} after duplicate detection failure`
        )
        return alternativeTrack
      }

      // No valid track available - pause playback
      if (this.deviceId) {
        await withErrorHandling(
          async () => {
            const SpotifyApiService = (await import('@/services/spotifyApi'))
              .SpotifyApiService
            await SpotifyApiService.getInstance().pausePlayback(this.deviceId!)
          },
          '[findNextValidTrack] Pause playback after duplicate detection',
          this.addLog ?? undefined
        )
      }
      return null
    }

    return validTrack
  }

  private async handleTrackFinished(state: PlayerSDKState): Promise<void> {
    const currentTrack = state.track_window?.current_track

    if (!currentTrack?.id) {
      this.log(
        'WARN',
        '[handleTrackFinished] Track finished but no track ID available'
      )
      return
    }

    const currentSpotifyTrackId = currentTrack.id
    const currentTrackName = currentTrack.name || 'Unknown'

    this.log(
      'INFO',
      `[handleTrackFinished] Track finished - ID: ${currentSpotifyTrackId}, Name: ${currentTrackName}, Position: ${state.position}, Duration: ${state.duration}`
    )

    // Use shared duplicate detector to prevent duplicate processing
    if (!this.duplicateDetector.shouldProcessTrack(currentSpotifyTrackId)) {
      this.duplicateDetector.setLastKnownPlayingTrack(currentSpotifyTrackId)
      this.log(
        'INFO',
        `[handleTrackFinished] Skipping duplicate processing for track: ${currentSpotifyTrackId}`
      )
      return
    }

    // Mark finished track as played
    await this.markFinishedTrackAsPlayed(
      currentSpotifyTrackId,
      currentTrackName
    )

    // Clear currently playing track before finding next one
    queueManager.setCurrentlyPlayingTrack(null)

    // Find next valid track (handles duplicate detection)
    const nextTrack = await this.findNextValidTrack(currentSpotifyTrackId)

    if (nextTrack) {
      this.currentQueueTrack = nextTrack
      this.log(
        'INFO',
        `[handleTrackFinished] Playing next track: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id}), Queue ID: ${nextTrack.id}`
      )
      await this.playNextTrack(nextTrack)
    } else {
      this.currentQueueTrack = null
      this.log(
        'WARN',
        '[handleTrackFinished] No next track available after track finished. Playback will stop.'
      )
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
      // Update queue manager with currently playing track so getNextTrack() excludes it
      queueManager.setCurrentlyPlayingTrack(currentSpotifyTrack.id)

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
    } else if (!currentSpotifyTrack || state.paused) {
      // Clear currently playing track when paused or no track
      queueManager.setCurrentlyPlayingTrack(null)
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
      // Check both error message and error code if available
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const errorCode =
        error instanceof Error && 'code' in error
          ? (error as Error & { code?: string }).code
          : undefined

      const needsUserAction =
        errorCode === 'INVALID_REFRESH_TOKEN' ||
        errorCode === 'INVALID_CLIENT_CREDENTIALS' ||
        errorCode === 'NO_REFRESH_TOKEN' ||
        errorCode === 'NOT_AUTHENTICATED' ||
        errorMessage.includes('INVALID_REFRESH_TOKEN') ||
        errorMessage.includes('INVALID_CLIENT_CREDENTIALS') ||
        errorMessage.includes('NO_REFRESH_TOKEN') ||
        errorMessage.includes('NOT_AUTHENTICATED')

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
    this.timeoutManager.clearAll()
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
      this.timeoutManager.clear('cleanup')

      onStatusChange('initializing')

      // Verify token is available before creating player
      let tokenCheck: string | null = null
      try {
        tokenCheck = await tokenManager.getToken()
        if (!tokenCheck) {
          this.log('ERROR', 'Token manager returned null token')
          onStatusChange('error', 'Initialization error: No token available')
          throw new Error('No token available for player initialization')
        }
        this.log(
          'INFO',
          `Token retrieved successfully (length: ${tokenCheck.length})`
        )
      } catch (tokenError) {
        this.log(
          'ERROR',
          'Failed to get token before player initialization',
          tokenError
        )
        onStatusChange(
          'error',
          `Initialization error: Token retrieval failed - ${tokenError instanceof Error ? tokenError.message : 'Unknown error'}`
        )
        throw tokenError
      }

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

      // Set up event listeners
      player.addListener('ready', ({ device_id }) => {
        void (async () => {
          this.timeoutManager.clear('notReady')

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
        })()
      })

      player.addListener('not_ready', (event) => {
        void this.handleNotReady(event.device_id, onStatusChange)
      })

      player.addListener('initialization_error', ({ message }) => {
        // Get additional context for better diagnostics
        const sdkAvailable = typeof window.Spotify !== 'undefined'
        const tokenCheck = tokenManager.getToken().catch(() => null)

        void tokenCheck.then((token) => {
          const errorDetails = {
            sdkMessage: message,
            sdkAvailable,
            hasToken: !!token,
            tokenLength: token?.length ?? 0,
            userAgent:
              typeof navigator !== 'undefined'
                ? navigator.userAgent
                : 'unknown',
            timestamp: new Date().toISOString()
          }

          this.log(
            'ERROR',
            `Failed to initialize player: ${message}. Context: SDK=${sdkAvailable}, Token=${!!token}, TokenLength=${token?.length ?? 0}`,
            new Error(JSON.stringify(errorDetails, null, 2))
          )
        })

        onStatusChange(
          'error',
          `Initialization error: ${message}. Check console for details.`
        )
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
      const cleanupTimeout = setTimeout(() => {
        if (this.playerRef === player) {
          this.log(
            'INFO',
            'Cleanup timeout reached, player may need reinitialization'
          )
        }
      }, PLAYER_LIFECYCLE_CONFIG.CLEANUP_TIMEOUT_MS)
      this.timeoutManager.set('cleanup', cleanupTimeout)

      // Return device ID when ready event fires
      // Store cleanup function to prevent memory leaks
      let cleanup: (() => void) | null = null

      return new Promise<string>((resolve, reject) => {
        const readyHandler = (event: { device_id: string }): void => {
          cleanup?.() // Remove listeners to prevent memory leaks
          resolve(event.device_id)
        }
        const errorHandler = (event: { message: string }): void => {
          cleanup?.() // Remove listeners to prevent memory leaks
          reject(new Error(event.message))
        }

        player.addListener('ready', readyHandler)
        player.addListener('initialization_error', errorHandler)

        // Store cleanup function
        cleanup = (): void => {
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

  /**
   * Public helper to play the next track from the current jukebox queue.
   * This is used by user-initiated actions (e.g. admin skip) so that
   * all track-to-track transitions still flow through the same internal
   * playNextTrack logic and device management.
   */
  async playNextFromQueue(): Promise<void> {
    this.log(
      'INFO',
      '[playNextFromQueue] Requested to play next track from queue'
    )
    const nextTrack = queueManager.getNextTrack()
    if (!nextTrack) {
      this.log(
        'WARN',
        '[playNextFromQueue] Skip requested but no next track is available in queue'
      )
      return
    }

    await this.playNextTrack(nextTrack)
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

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalReady = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = (): void => {
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
      window.onSpotifyWebPlaybackSDKError = (error: unknown): void => {
        cleanup() // Clear timeout on error
        this.log('ERROR', 'Failed to reload Spotify SDK', error)
        if (originalError) {
          // Call original function - use call with null to avoid unbound method warning
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
