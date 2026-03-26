import { JukeboxQueueItem } from '@/shared/types/queue'
import { sendApiRequest } from '@/shared/api'
import { QueueManager } from './queueManager'
import { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { PLAYER_LIFECYCLE_CONFIG } from './playerLifecycleConfig'
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { transferPlaybackToDevice } from '@/services/deviceManagement'
import { buildTrackUri } from '@/shared/utils/spotifyUri'

interface AutoPlayServiceConfig {
  checkInterval?: number // How often to check playback state (default: 5 seconds)
  deviceId?: string | null
  onTrackFinished?: (trackId: string) => void
  onNextTrackStarted?: (track: JukeboxQueueItem) => void
  onQueueEmpty?: () => void
  onQueueLow?: () => void // New callback for when queue is low
  username?: string | null // Username for auto-fill operations
  autoFillTargetSize?: number // Target number of tracks for auto-fill (default: 10)
  autoFillMaxAttempts?: number // Maximum attempts for auto-fill (default: 20)
  queueCheckInterval?: number // How often to check queue for auto-fill (default: 10000ms)
}

class AutoPlayService {
  private isRunning = false
  private checkInterval: number
  private deviceId: string | null = null
  private lastPlaybackState: SpotifyPlaybackState | null = null
  private lastTrackId: string | null = null
  private intervalRef: NodeJS.Timeout | null = null
  private queueManager: QueueManager
  private onTrackFinished?: (trackId: string) => void
  private onNextTrackStarted?: (track: JukeboxQueueItem) => void
  private onQueueEmpty?: () => void
  private onQueueLow?: () => void
  private username: string | null = null
  private isAutoFilling = false // Prevent multiple simultaneous auto-fill operations
  private duplicateDetector: TrackDuplicateDetector =
    new TrackDuplicateDetector()
  private autoFillTargetSize: number
  private autoFillMaxAttempts: number
  private activePrompt: string = ''
  private autoFillDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastAutoFillCompletionTime = 0
  private isAutoPlayDisabled: boolean = false // Flag to temporarily disable auto-play during manual operations
  private isInitialized: boolean = false // Flag to track if the service is properly initialized
  private isPolling = false // Guard flag to prevent overlapping requests
  private lastQueueCheckTime = 0
  private readonly QUEUE_CHECK_INTERVAL: number // Check queue periodically, not every poll
  private addLog:
    | ((
        level: LogLevel,
        message: string,
        context?: string,
        error?: Error
      ) => void)
    | null = null

  constructor(config: AutoPlayServiceConfig = {}) {
    this.checkInterval = config.checkInterval || 1000 // Increased to 1000ms baseline to reduce API calls
    this.deviceId = config.deviceId || null
    this.onTrackFinished = config.onTrackFinished
    this.onNextTrackStarted = config.onNextTrackStarted
    this.onQueueEmpty = config.onQueueEmpty
    this.onQueueLow = config.onQueueLow
    this.username = config.username || null
    this.autoFillTargetSize = config.autoFillTargetSize || 10 // Default fallback, will be overridden by track suggestions state
    this.autoFillMaxAttempts = config.autoFillMaxAttempts || 20
    this.QUEUE_CHECK_INTERVAL = config.queueCheckInterval || 10000 // Default to 10 seconds
    this.queueManager = QueueManager.getInstance()
  }

  public start(): void {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.isPolling = false // Reset polling state

    // Start with the configured check interval
    this.startPolling()
  }

  private startPolling(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef)
    }

    this.intervalRef = setInterval(() => {
      // Wrap in error handler to prevent interval from continuing on fatal errors
      void this.checkPlaybackState().catch((error) => {
        // Stop the service on fatal error to prevent memory leaks
        this.stop()
      })
    }, this.checkInterval)
  }

  private adjustPollingInterval(currentState: SpotifyPlaybackState): void {
    if (!currentState.item || !currentState.is_playing) {
      return
    }

    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const timeRemaining = duration - progress

    // Dynamic polling: increase frequency when approaching track end
    let newInterval = 1000 // Default 1000ms baseline to reduce API calls

    if (timeRemaining <= 10000) {
      // Last 10 seconds: poll every 100ms for better precision
      newInterval = 100
    } else if (timeRemaining <= 30000) {
      // Last 30 seconds: poll every 250ms
      newInterval = 250
    } else {
      // Rest of the track: poll every 1000ms to reduce API calls
      newInterval = 1000
    }

    // Update interval if it changed
    if (newInterval !== this.checkInterval) {
      this.checkInterval = newInterval
      this.startPolling()
    }
  }

  public stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    this.isPolling = false

    if (this.intervalRef) {
      clearInterval(this.intervalRef)
      this.intervalRef = null
    }
  }

  public setDeviceId(deviceId: string | null): void {
    if (this.deviceId !== deviceId) {
      this.deviceId = deviceId
    }
  }

  public setUsername(username: string | null): void {
    this.username = username
  }

  public setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ): void {
    this.addLog = logger
  }

  public updateQueue(queue: JukeboxQueueItem[]): void {
    this.queueManager.updateQueue(queue)
  }

  private scheduleAutoFillCheck(delayMs: number = 500): void {
    // Always coalesce into a single pending check
    if (this.autoFillDebounceTimer) {
      return // Already scheduled, don't reschedule
    }
    this.autoFillDebounceTimer = setTimeout(() => {
      this.autoFillDebounceTimer = null
      void this.checkAndAutoFillQueue()
    }, delayMs)
  }

  public setActivePrompt(prompt: string): void {
    this.activePrompt = prompt
  }

  public setAutoFillTargetSize(targetSize: number): void {
    this.autoFillTargetSize = targetSize
  }

  public disableAutoPlay(): void {
    this.isAutoPlayDisabled = true
  }

  public enableAutoPlay(): void {
    this.isAutoPlayDisabled = false
  }

  public markAsInitialized(): void {
    this.isInitialized = true
  }

  private async checkPlaybackState(): Promise<void> {
    // Prevent overlapping polling requests to avoid race conditions
    if (this.isPolling) {
      return
    }

    this.isPolling = true

    try {
      const currentState = await this.getCurrentPlaybackState()

      // Throttled queue checks - only check queue periodically instead of every playback poll
      // This reduces unnecessary API calls and improves performance
      const now = Date.now()
      if (
        this.isInitialized &&
        this.username &&
        now - this.lastQueueCheckTime > this.QUEUE_CHECK_INTERVAL
      ) {
        this.lastQueueCheckTime = now
        this.scheduleAutoFillCheck(0)
      }

      if (!currentState) {
        // Proactive safety net: if the service is initialized, auto-play is
        // enabled, and there are tracks waiting in the jukebox queue, delegate
        // starting the next track to PlayerLifecycleService so that all
        // track-to-track transitions go through a single, canonical path.
        if (this.isInitialized && this.username && !this.isAutoPlayDisabled) {
          const nextTrack = this.queueManager.getNextTrack()
          if (nextTrack) {
            try {
              await playerLifecycleService.skipToTrack(nextTrack)
            } catch (error) {}
          }
        }

        return
      }

      const currentTrackId = currentState.item?.id
      const isPlaying = currentState.is_playing
      const progress = currentState.progress_ms || 0
      const duration = currentState.item?.duration_ms || 0

      // Reset duplicate detector if we're playing a different track
      // Edge case: Manual skip detected
      if (currentTrackId && currentTrackId !== this.lastTrackId) {
        this.duplicateDetector.setLastKnownPlayingTrack(currentTrackId)
      }

      // Fallback: Check if track has finished (for edge cases)
      if (this.hasTrackFinished(currentState)) {
        try {
          await this.handleTrackFinished(currentTrackId)
        } catch (error) {}
      }

      // Adjust polling interval based on track progress
      this.adjustPollingInterval(currentState)

      // Update last known state - only store essential fields to minimize memory usage
      // This prevents accumulation of image URLs and other metadata
      this.lastPlaybackState = {
        is_playing: currentState.is_playing,
        progress_ms: currentState.progress_ms,
        item: currentState.item
          ? {
              id: currentState.item.id,
              duration_ms: currentState.item.duration_ms,
              name: currentState.item.name
            }
          : null
      } as SpotifyPlaybackState
      this.lastTrackId = currentTrackId || null
    } catch (error) {
    } finally {
      // Auto-Resume Logic (Issue #12)
      // Check if we need to auto-resume playback if it was paused without user interaction
      if (
        this.lastPlaybackState &&
        !this.lastPlaybackState.is_playing &&
        !playerLifecycleService.getIsManualPause() &&
        this.isInitialized &&
        this.username &&
        !this.isAutoPlayDisabled
      ) {
        // Only attempt auto-resume if device is active/ready
        // If device is not active, that's a recovery scenario handled by handleNotReady/recoveryManager
        // checking !this.lastPlaybackState.item is handled by hasTrackFinished check above
        // We only want to resume if we have an item (paused mid-track)
        if (this.lastPlaybackState.item) {
          // Double check we haven't just finished a track (which is handled separately)
          const isTrackFinished = this.hasTrackFinished(this.lastPlaybackState)
          if (!isTrackFinished) {
            try {
              // Use playerLifecycleService to resume so it can manage state (conceptually, though resumePlayback just calls spotifyPlayer)
              await playerLifecycleService.resumePlayback()
            } catch (resumeError) {}
          } else {
          }
        }
      }

      this.isPolling = false
    }
  }

  private hasTrackFinished(currentState: SpotifyPlaybackState): boolean {
    if (!this.lastPlaybackState || !currentState.item) {
      return false
    }

    const lastState = this.lastPlaybackState
    const currentTrackId = currentState.item.id
    const lastTrackId = lastState.item?.id

    // More sensitive detection - check multiple conditions
    const progress = currentState.progress_ms || 0
    const duration = currentState.item.duration_ms || 0
    const isAtEnd =
      duration > 0 &&
      duration - progress < PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS
    const isSameTrack = currentTrackId === lastTrackId
    const wasPlaying = lastState.is_playing
    const isPaused = !currentState.is_playing
    const isStopped = !currentState.is_playing && progress === 0 // Track stopped and reset to beginning
    const hasProgressed = progress > (lastState.progress_ms || 0) // Track has progressed since last check
    const isNearEnd =
      duration > 0 &&
      duration - progress < PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS / 2 // Very near end
    const hasStalled = !hasProgressed && wasPlaying && isSameTrack // Track has stalled

    // Detailed debug logging for tracking down Issue #12 (re-playing same song)
    if (isNearEnd || isAtEnd || isStopped || (isPaused && wasPlaying)) {
    }

    // Track finished if:
    // 1. We were playing, now paused/stopped, same track, near end
    // 2. Track stopped and reset to beginning (natural end)
    // 3. Track is at the end and not progressing (stuck at end)
    // 4. Track is very near end and has stalled (new condition for faster detection)
    // 5. Track is paused and very near end (new condition)
    const finished =
      (wasPlaying && (isPaused || isStopped) && isSameTrack && isAtEnd) ||
      (isStopped && isSameTrack) ||
      (isAtEnd && isSameTrack && !hasProgressed && wasPlaying) ||
      (isNearEnd && hasStalled) ||
      (isPaused && isNearEnd && isSameTrack)

    if (finished) {
    }

    return finished
  }

  private async handleTrackFinished(
    trackId: string | undefined
  ): Promise<void> {
    if (!trackId) {
      return
    }

    // Prevent processing the same track multiple times
    if (!this.duplicateDetector.shouldProcessTrack(trackId)) {
      return
    }
    this.onTrackFinished?.(trackId)

    try {
      // Find the queue item with this Spotify track ID
      const queue = this.queueManager.getQueue()

      const queueItem = queue.find(
        (item) => item.tracks.spotify_track_id === trackId
      )

      if (queueItem) {
        // Track is in queue - mark it as played
        try {
          await this.queueManager.markAsPlayed(queueItem.id)
          // Small delay to ensure DELETE has propagated to database before refreshing
          // This prevents race conditions where refresh brings back the track that was just deleted
          await new Promise((resolve) => setTimeout(resolve, 200))
          // Refresh queue from API after marking as played to ensure sync
          // This prevents issues where the next track is the same as the finished track
          if (this.username) {
            try {
              const freshQueueLength = await this.refreshQueueFromAPI()
              if (freshQueueLength !== null) {
              }
            } catch (refreshError) {}
          }
        } catch (error) {
          // Continue with next track even if marking as played fails
        }
      } else {
      }

      // Schedule auto-fill check (debounced to prevent races)
      this.scheduleAutoFillCheck(500)

      // At this point AutoPlayService has updated queue state and ensured
      // auto-fill runs when needed. Playback transitions themselves are
      // handled by PlayerLifecycleService via SDK events, so we no longer
      // attempt to start the next track from here. This avoids race
      // conditions where both services try to control playback.

      // Check if queue is empty after removals/auto-fill
      const nextTrack = this.queueManager.getQueue()[0]
      if (!nextTrack) {
        this.onQueueEmpty?.()
      }
    } catch (error) {}
  }

  private async refreshQueueFromAPI(): Promise<number | null> {
    if (!this.username) {
      return null
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

      let response: Response
      try {
        response = await fetch(`/api/playlist/${this.username}`, {
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        return null
      }

      const queue = (await response.json()) as JukeboxQueueItem[]
      const cachedQueueLength = this.queueManager.getQueue().length

      this.queueManager.updateQueue(queue)

      return queue.length
    } catch (error) {
      return null
    }
  }

  private async checkAndAutoFillQueue(): Promise<void> {
    // Atomic guard: if already auto-filling, skip entirely
    if (this.isAutoFilling) {
      return
    }

    // Cooldown: don't re-trigger within 15 seconds of last completion
    const now = Date.now()
    if (now - this.lastAutoFillCompletionTime < 15000) {
      return
    }

    // Set flag immediately to prevent concurrent calls
    this.isAutoFilling = true

    try {
      // Refresh queue from API to get accurate current size
      const cachedQueue = this.queueManager.getQueue()
      const cachedQueueLength = cachedQueue.length

      const freshQueueLength = await this.refreshQueueFromAPI()
      const currentQueueLength = freshQueueLength ?? cachedQueueLength

      // Check if queue is low (below target size)
      if (
        currentQueueLength < this.autoFillTargetSize &&
        this.username &&
        this.isInitialized
      ) {
        this.onQueueLow?.()
        await this.autoFillQueue()
      }
    } catch (error) {
      // Silently handle errors
    } finally {
      this.isAutoFilling = false
      this.lastAutoFillCompletionTime = Date.now()
      // Clear any pending timer to prevent immediate re-trigger
      if (this.autoFillDebounceTimer) {
        clearTimeout(this.autoFillDebounceTimer)
        this.autoFillDebounceTimer = null
      }
    }
  }

  private async autoFillQueue(): Promise<void> {
    if (!this.username || !this.activePrompt) {
      if (this.addLog) {
        this.addLog(
          'WARN',
          `[SOURCE:NONE] Auto-fill skipped: username=${!!this.username}, activePrompt="${this.activePrompt?.slice(0, 50) || ''}"`,
          'AutoPlayService'
        )
      }
      return
    }

    if (this.addLog) {
      this.addLog(
        'INFO',
        `[SOURCE:AI] Starting auto-fill with prompt: "${this.activePrompt.slice(0, 60)}..."`,
        'AutoPlayService'
      )
    }

    let tracksAdded = 0

    // Request a batch from AI
    const currentQueue = this.queueManager.getQueue()
    const excludedTrackIds = currentQueue.map(
      (item) => item.tracks.spotify_track_id
    )

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      let response: Response

      try {
        response = await fetch('/api/ai-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: this.activePrompt,
            excludedTrackIds,
            profileId: this.username
          }),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown')
        if (this.addLog) {
          this.addLog(
            'WARN',
            `[SOURCE:AI] AI request failed (${response.status}): ${errorBody.slice(0, 200)}. Falling back to random track.`,
            'AutoPlayService'
          )
        }
        await this.fallbackToRandomTrack()
        return
      }

      const result = (await response.json()) as {
        success: boolean
        tracks: Array<{ id: string; title: string; artist: string }>
        error?: string
      }

      if (!result.success || !result.tracks || result.tracks.length === 0) {
        if (this.addLog) {
          this.addLog(
            'WARN',
            `[SOURCE:AI] AI returned no tracks: ${result.error || 'unknown'}. Falling back to random track.`,
            'AutoPlayService'
          )
        }
        await this.fallbackToRandomTrack()
        return
      }

      // Add all returned tracks to queue
      if (this.addLog) {
        this.addLog(
          'INFO',
          `[SOURCE:AI] Received ${result.tracks.length} tracks from AI, adding all to queue`,
          'AutoPlayService'
        )
      }
      for (const track of result.tracks) {
        try {
          if (this.addLog) {
            this.addLog(
              'INFO',
              `[SOURCE:AI] Adding AI track: "${track.title}" by ${track.artist} (${track.id})`,
              'AutoPlayService'
            )
          }
          await this.addTrackToQueue(track.id)
          tracksAdded++
        } catch (error) {
          if (this.addLog) {
            this.addLog(
              'ERROR',
              `[SOURCE:AI] Failed to add AI track ${track.title} to queue`,
              'AutoPlayService',
              error instanceof Error ? error : undefined
            )
          }
        }
      }
    } catch (error) {
      if (this.addLog) {
        this.addLog(
          'ERROR',
          `[SOURCE:AI] AI suggestions network error: ${error instanceof Error ? error.message : String(error)}. Falling back to random track.`,
          'AutoPlayService',
          error instanceof Error ? error : undefined
        )
      }
      // Network/parse error — fall back to random track
      await this.fallbackToRandomTrack()
    }

    if (this.addLog) {
      this.addLog(
        'INFO',
        `[SOURCE:AI] Auto-fill complete. Added ${tracksAdded} tracks total`,
        'AutoPlayService'
      )
    }
  }

  private async addTrackToQueue(spotifyTrackId: string): Promise<void> {
    // Fetch full track details from Spotify
    const trackDetails = await sendApiRequest<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        name: string
        images: Array<{ url: string }>
        release_date?: string
      }
      duration_ms: number
      popularity: number
      uri: string
      explicit: boolean
    }>({
      path: `tracks/${spotifyTrackId}`,
      method: 'GET'
    })

    // Add track to queue via playlist API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    let playlistResponse: Response

    try {
      playlistResponse = await fetch(`/api/playlist/${this.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracks: trackDetails,
          initialVotes: 1,
          source: 'system'
        }),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!playlistResponse.ok) {
      if (playlistResponse.status === 409) {
        return // Track already in playlist, skip silently
      }
      throw new Error(`Failed to add track to playlist: ${playlistResponse.status}`)
    }

    // Show notification for auto-added track
    const albumArtUrl =
      trackDetails.album.images && trackDetails.album.images.length > 0
        ? (trackDetails.album.images[0]?.url ?? null)
        : null

    this.showAutoFillNotification({
      trackName: trackDetails.name,
      artistName: trackDetails.artists[0]?.name || 'Unknown Artist',
      albumName: trackDetails.album.name,
      albumArtUrl,
      allArtists: trackDetails.artists.map((artist) => artist.name),
      durationMs: trackDetails.duration_ms,
      popularity: trackDetails.popularity,
      explicit: trackDetails.explicit,
      isFallback: false
    })
  }

  private async fallbackToRandomTrack(): Promise<boolean> {
    if (!this.username) {
      return false
    }

    if (this.addLog) {
      this.addLog(
        'WARN',
        '[SOURCE:FALLBACK] Falling back to random track from database',
        'AutoPlayService'
      )
    }

    // Get current queue to exclude existing tracks
    const currentQueue = this.queueManager.getQueue()
    const excludedTrackIds = currentQueue.map(
      (item) => item.tracks.spotify_track_id
    )

    let attempts = 0
    const maxAttempts = 5
    while (attempts < maxAttempts) {
      attempts++
      try {
        const requestBody = { username: this.username, excludedTrackIds }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        let response: Response

        try {
          response = await fetch('/api/random-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) {
          const errorBody = await response.json()
          if (response.status === 404) {
            return false
          }
          throw new Error('Failed to get random track for fallback.')
        }

        const result = (await response.json()) as {
          success: boolean
          track: {
            id: string
            spotify_track_id: string
            name: string
            artist: string
            album: string
            duration_ms: number
            popularity: number
            spotify_url: string
          }
        }

        if (result.success && result.track) {
          if (excludedTrackIds.includes(result.track.spotify_track_id)) {
            continue
          }

          const playlistController = new AbortController()
          const playlistTimeoutId = setTimeout(
            () => playlistController.abort(),
            10000
          )
          let playlistResponse: Response

          try {
            playlistResponse = await fetch(`/api/playlist/${this.username}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tracks: {
                  id: result.track.spotify_track_id,
                  name: result.track.name,
                  artists: [{ name: result.track.artist }],
                  album: { name: result.track.album },
                  duration_ms: result.track.duration_ms,
                  popularity: result.track.popularity,
                  uri: result.track.spotify_url
                },
                initialVotes: 1,
                source: 'fallback'
              }),
              signal: playlistController.signal
            })
          } finally {
            clearTimeout(playlistTimeoutId)
          }

          if (!playlistResponse.ok) {
            if (playlistResponse.status === 409) {
              continue
            }
            return false
          }

          this.showAutoFillNotification({
            trackName: result.track.name,
            artistName: result.track.artist,
            albumName: result.track.album,
            albumArtUrl: null,
            allArtists: [result.track.artist],
            durationMs: result.track.duration_ms,
            popularity: result.track.popularity,
            explicit: null,
            isFallback: true
          })
          if (this.addLog) {
            this.addLog(
              'INFO',
              `[SOURCE:FALLBACK] Added random track: "${result.track.name}" by ${result.track.artist} (${result.track.spotify_track_id})`,
              'AutoPlayService'
            )
          }
          return true
        } else {
          return false
        }
      } catch (error) {
        if (this.addLog) {
          this.addLog(
            'ERROR',
            'Fallback to random track failed',
            'AutoPlayService',
            error instanceof Error ? error : undefined
          )
        }
      }
    }
    return false
  }

  private showAutoFillNotification(trackMetadata: {
    trackName: string
    artistName: string
    albumName?: string
    albumArtUrl?: string | null
    allArtists?: string[]
    durationMs?: number
    popularity?: number
    explicit?: boolean | null
    isFallback?: boolean
  }): void {
    // Only dispatch events on the client side
    if (typeof window !== 'undefined') {
      // Create a custom event to trigger the notification
      const event = new CustomEvent('autoFillNotification', {
        detail: {
          trackName: trackMetadata.trackName,
          artistName: trackMetadata.artistName,
          albumName: trackMetadata.albumName,
          albumArtUrl: trackMetadata.albumArtUrl ?? null,
          allArtists: trackMetadata.allArtists ?? [trackMetadata.artistName],
          durationMs: trackMetadata.durationMs,
          popularity: trackMetadata.popularity,
          explicit: trackMetadata.explicit ?? null,
          isFallback: trackMetadata.isFallback ?? false,
          timestamp: Date.now()
        }
      })

      // Dispatch the event on the window object
      window.dispatchEvent(event)
    }
  }

  private async playNextTrack(
    track: JukeboxQueueItem,
    isPredictive: boolean = false
  ): Promise<void> {
    if (!this.deviceId) {
      return
    }

    // Log track transition attempt with context

    // Always transfer playback to the app's device before playing
    // Add retry logic with exponential backoff for transfer failures
    let transferred = false
    const maxTransferRetries = 2
    let transferAttempt = 0
    const transferErrors: Error[] = []

    while (!transferred && transferAttempt <= maxTransferRetries) {
      try {
        transferred = await transferPlaybackToDevice(this.deviceId)
      } catch (transferError) {
        transferErrors.push(
          transferError instanceof Error
            ? transferError
            : new Error(String(transferError))
        )
        transferred = false
      }

      if (!transferred) {
        transferAttempt++
        if (transferAttempt <= maxTransferRetries) {
          const retryDelay = 1000 * transferAttempt // Exponential backoff: 1s, 2s
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
        } else {
          // Fallback: Check if device is already active via alternative method
          try {
            const playbackState = await sendApiRequest<{
              device?: { id: string; is_active: boolean }
              is_playing: boolean
            }>({
              path: 'me/player',
              method: 'GET'
            })

            if (
              playbackState?.device?.id === this.deviceId &&
              playbackState.device.is_active
            ) {
              transferred = true // Treat as success since device is active
            } else {
            }
          } catch (fallbackError) {
            // Attempt playback anyway - device might be active but API is having issues
            transferred = true
          }
        }
      }
    }

    if (!transferred) {
      // Don't return early - attempt playback anyway as last resort
      // Device might be active but transfer API is having issues
      // If playback fails, error recovery in catch block will handle it
    }

    // Defensive check: verify we're not about to play a track that's already playing
    // This is a final safety net to catch edge cases where all other protections failed
    try {
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
        // Remove duplicate track from queue and try next track
        try {
          await this.queueManager.markAsPlayed(track.id)
        } catch (error) {}

        // Attempt to play the next track instead of returning early
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          try {
            await this.playNextTrack(nextTrack, false)
            return // Success - exit early
          } catch (error) {
            // Error recovery in catch block will handle further attempts
          }
        } else {
        }
        return
      }
    } catch (apiError) {
      // If we can't verify, log warning but continue with playback
    }

    try {
      const trackUri = buildTrackUri(track.tracks.spotify_track_id)

      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: this.deviceId,
          uris: [trackUri]
        }
      })

      // Update queue manager with currently playing track so getNextTrack() excludes it
      this.queueManager.setCurrentlyPlayingTrack(track.tracks.spotify_track_id)

      this.onNextTrackStarted?.(track)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      // Check if error is transient (network, timeout) vs permanent (restriction violated)
      const isTransientError =
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT')

      // For transient errors, attempt one retry before giving up
      if (isTransientError) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait 1s before retry
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              device_id: this.deviceId,
              uris: [buildTrackUri(track.tracks.spotify_track_id)]
            }
          })
          this.onNextTrackStarted?.(track)
          return // Success - exit early
        } catch (retryError) {
          // Continue with error recovery below
        }
      }

      // Error recovery: attempt to remove problematic track and try next track
      try {
        await this.queueManager.markAsPlayed(track.id)

        // Try to play the next track in queue
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          // Recursively attempt to play next track (non-predictive mode)
          await this.playNextTrack(nextTrack, false)
          // If successful, don't reset predictive state
          return
        } else {
        }
      } catch (recoveryError) {}

      // Only reset predictive state if no recovery was possible
      if (isPredictive) {
        this.resetPredictiveState()
      }
    }
  }

  private async getAccessToken(): Promise<string | null> {
    try {
      // Use the existing sendApiRequest to get a token
      // This will use the admin credentials from the database
      const response = await sendApiRequest<{ access_token: string }>({
        path: 'token',
        method: 'GET',
        isLocalApi: true
      })

      return response?.access_token || null
    } catch (error) {
      return null
    }
  }

  private async getCurrentPlaybackState(): Promise<SpotifyPlaybackState | null> {
    return await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
  }

  public isActive(): boolean {
    return this.isRunning
  }

  public getLastTrackId(): string | null {
    return this.lastTrackId
  }

  public getStatus(): {
    isRunning: boolean
    deviceId: string | null
    username: string | null
    isAutoPlayDisabled: boolean
    isInitialized: boolean
    queueLength: number
  } {
    return {
      isRunning: this.isRunning,
      deviceId: this.deviceId,
      username: this.username,
      isAutoPlayDisabled: this.isAutoPlayDisabled,
      isInitialized: this.isInitialized,
      queueLength: this.queueManager.getQueue().length
    }
  }

  public getLockedTrackId(): string | null {
    // Track locking feature not yet implemented
    // Returns null to indicate no track is currently locked
    return null
  }

  private resetPredictiveState(): void {
    // Reset last playback state to force a fresh check on next poll
    // This prevents stale track preparation after state changes (e.g., seeking)
    this.lastPlaybackState = null
    this.lastTrackId = null
  }

  public resetAfterSeek(): void {
    // Reset predictive state after seeking to prevent stale track preparation
    // This will also immediately prepare next track if we seeked to near the end
    this.resetPredictiveState()

    // Trigger an immediate playback state check to re-evaluate position
    if (this.isRunning) {
      void this.checkPlaybackState()
    }
  }
}

// Singleton instance
let autoPlayServiceInstance: AutoPlayService | null = null

export function getAutoPlayService(
  config?: AutoPlayServiceConfig
): AutoPlayService {
  if (!autoPlayServiceInstance) {
    autoPlayServiceInstance = new AutoPlayService(config)
  }
  return autoPlayServiceInstance
}

export function resetAutoPlayService(): void {
  if (autoPlayServiceInstance) {
    autoPlayServiceInstance.stop()
    autoPlayServiceInstance = null
  }
}

export { AutoPlayService }
