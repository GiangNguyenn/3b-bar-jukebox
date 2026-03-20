import { queueManager } from '@/services/queueManager'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { PlayerSDKState } from './types'
import { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { TrackDuplicateDetector } from '@/shared/utils/trackDuplicateDetector'
import { PLAYER_LIFECYCLE_CONFIG } from '../playerLifecycleConfig'
import { ensureTrackNotDuplicate, withErrorHandling } from './utils'
import { buildTrackUri } from '@/shared/utils/spotifyUri'
import { upsertPlayedTrack } from '@/lib/trackUpsert'
import { playbackService } from '@/services/player'
import { DJService } from '@/services/djService'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'

export interface PlaybackController {
  playTrackWithRetry(
    trackUri: string,
    deviceId: string,
    maxRetries?: number
  ): Promise<boolean>
  log(level: LogLevel, message: string, error?: unknown): void
  getDeviceId(): string | null
}

export class QueueSynchronizer {
  private currentQueueTrack: JukeboxQueueItem | null = null
  private duplicateDetector = new TrackDuplicateDetector()
  private lastKnownState: PlayerSDKState | null = null
  private lastStateUpdateTime: number = 0

  constructor(private controller: PlaybackController) {}

  initializeQueue(): void {
    this.currentQueueTrack = queueManager.getNextTrack() ?? null
  }

  getCurrentQueueTrack(): JukeboxQueueItem | null {
    return this.currentQueueTrack
  }

  setCurrentQueueTrack(track: JukeboxQueueItem | null) {
    this.currentQueueTrack = track
  }

  getLastKnownState(): PlayerSDKState | null {
    return this.lastKnownState
  }

  setLastKnownState(state: PlayerSDKState | null) {
    this.lastKnownState = state
    this.lastStateUpdateTime = Date.now()
  }

  getDuplicateDetector(): TrackDuplicateDetector {
    return this.duplicateDetector
  }

  private getLogger() {
    return (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => {}
  }

  /**
   * Play next track from queue with retry logic and duplicate detection.
   */
  async playNextTrack(track: JukeboxQueueItem): Promise<void> {
    await playbackService.executePlayback(() => {
      return this.playNextTrackImpl(track)
    }, 'playNextTrack')
  }

  private async playNextTrackImpl(track: JukeboxQueueItem): Promise<void> {
    const deviceId = this.controller.getDeviceId()
    if (!deviceId) {
      return
    }

    const MAX_ATTEMPTS = PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxAttempts
    let currentTrack: JukeboxQueueItem | null = track
    let attempts = 0

    const lastPlayingTrackId =
      this.lastKnownState?.track_window?.current_track?.id ?? null

    const seenTrackIds = new Set<string>()

    while (
      currentTrack &&
      attempts < MAX_ATTEMPTS &&
      !seenTrackIds.has(currentTrack.tracks.spotify_track_id)
    ) {
      attempts++
      seenTrackIds.add(currentTrack.tracks.spotify_track_id)

      if (lastPlayingTrackId) {
        const validTrack = await ensureTrackNotDuplicate(
          currentTrack,
          lastPlayingTrackId,
          PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.duplicateCheckRetries,
          this.getLogger()
        )

        if (!validTrack) {
          break
        }

        currentTrack = validTrack
      }

      const trackUri = buildTrackUri(currentTrack.tracks.spotify_track_id)

      const success = await this.controller.playTrackWithRetry(
        trackUri,
        deviceId,
        PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxRetriesPerTrack
      )

      if (success) {
        if (!currentTrack) {
          return
        }

        const trackIdForUpsert = currentTrack.tracks.spotify_track_id
        void upsertPlayedTrack(trackIdForUpsert).catch(() => {})

        this.currentQueueTrack = currentTrack
        queueManager.setCurrentlyPlayingTrack(
          currentTrack.tracks.spotify_track_id
        )
        DJService.getInstance().onTrackStarted(
          currentTrack,
          queueManager.getNextTrack() ?? null
        )
        return
      }

      await withErrorHandling(
        async () => {
          await queueManager.markAsPlayed(currentTrack!.id)
        },
        '[playNextTrack] Remove failed track',
        this.getLogger()
      )

      currentTrack = queueManager.getNextTrack() ?? null
    }

    if (attempts >= MAX_ATTEMPTS) {
    } else if (!currentTrack) {
    }
  }

  async markFinishedTrackAsPlayed(
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
          await queueManager.markAsPlayed(finishedQueueItem.id)
        },
        '[markFinishedTrackAsPlayed] Mark track as played',
        this.getLogger()
      )
    } else {
      const potentialMatches = queue
        .map((item) => ({
          item,
          nameMatch: item.tracks.name.toLowerCase() === trackName.toLowerCase(),
          uriMatch: false
        }))
        .filter((match) => match.nameMatch)

      if (potentialMatches.length > 0) {
        const validMatch = potentialMatches[0].item

        await withErrorHandling(
          async () => {
            await queueManager.markAsPlayed(validMatch.id)
          },
          '[markFinishedTrackAsPlayed] Fuzzy removal',
          this.getLogger()
        )
      } else {
      }
    }
  }

  private async findNextValidTrack(
    finishedTrackId: string
  ): Promise<JukeboxQueueItem | null> {
    const nextTrack = queueManager.getNextTrack()

    if (!nextTrack) {
      return null
    }

    const validTrack = await ensureTrackNotDuplicate(
      nextTrack,
      finishedTrackId,
      PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.duplicateCheckRetries,
      this.getLogger()
    )

    if (!validTrack) {
      const alternativeTrack = queueManager.getTrackAfterNext()
      if (
        alternativeTrack &&
        alternativeTrack.tracks.spotify_track_id !== finishedTrackId
      ) {
        return alternativeTrack
      }

      const deviceId = this.controller.getDeviceId()
      if (deviceId) {
        await withErrorHandling(
          async () => {
            const SpotifyApiService = (await import('@/services/spotifyApi'))
              .SpotifyApiService
            await SpotifyApiService.getInstance().pausePlayback(deviceId)
          },
          '[findNextValidTrack] Pause playback after duplicate detection',
          this.getLogger()
        )
      }
      return null
    }

    return validTrack
  }

  async handleTrackFinished(state: PlayerSDKState): Promise<void> {
    spotifyPlayerStore.getState().setIsTransitionInProgress(true)
    try {
      await this.handleTrackFinishedImpl(state)
    } finally {
      spotifyPlayerStore.getState().setIsTransitionInProgress(false)
    }
  }

  private async handleTrackFinishedImpl(state: PlayerSDKState): Promise<void> {
    const currentTrack = state.track_window?.current_track
    if (!currentTrack?.id) {
      return
    }

    const currentSpotifyTrackId = currentTrack.id
    const currentTrackName = currentTrack.name || 'Unknown'

    // First serialized operation: mark played + find next track
    let nextTrack: JukeboxQueueItem | null = null
    await playbackService.executePlayback(async () => {
      if (!this.duplicateDetector.shouldProcessTrack(currentSpotifyTrackId)) {
        this.duplicateDetector.setLastKnownPlayingTrack(currentSpotifyTrackId)
        return
      }

      await this.markFinishedTrackAsPlayed(
        currentSpotifyTrackId,
        currentTrackName
      )

      queueManager.setCurrentlyPlayingTrack(null)

      nextTrack = await this.findNextValidTrack(currentSpotifyTrackId)

      if (nextTrack) {
        this.currentQueueTrack = nextTrack
      } else {
        this.currentQueueTrack = null
      }
    }, 'handleTrackFinished:lookup')

    if (!nextTrack) {
      return
    }

    // maybeAnnounce runs OUTSIDE the lock so it does not hold isOperationInProgress = true
    try {
      await DJService.getInstance().maybeAnnounce(nextTrack)
    } catch (error) {}

    // Second serialized operation: play the next track
    await playbackService.executePlayback(
      () => this.playNextTrackImpl(nextTrack!),
      'handleTrackFinished:play'
    )
  }

  syncQueueWithPlayback(state: PlayerSDKState): void {
    const currentSpotifyTrack = state.track_window?.current_track

    if (currentSpotifyTrack) {
      const currentTrackId = currentSpotifyTrack.id
      const lastKnownId = this.duplicateDetector.getLastKnownPlayingTrackId()

      if (lastKnownId !== currentTrackId) {
        this.duplicateDetector.setLastKnownPlayingTrack(currentTrackId)
      }
    }

    if (!currentSpotifyTrack || state.paused) {
      queueManager.setCurrentlyPlayingTrack(null)
      return
    }

    queueManager.setCurrentlyPlayingTrack(currentSpotifyTrack.id)

    // Skip queue-enforcement branch while a playback operation is in progress
    // to avoid race conditions, but allow state updates above to pass through.
    if (playbackService.isOperationInProgress()) {
      return
    }

    const queue = queueManager.getQueue()
    const matchingQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === currentSpotifyTrack.id
    )

    if (matchingQueueItem) {
      if (this.currentQueueTrack?.id !== matchingQueueItem.id) {
        this.currentQueueTrack = matchingQueueItem
      }
    } else {
      if (queue.length > 0 && !state.paused) {
        const expectedTrack = this.currentQueueTrack || queue[0]

        // Fix: Check for Track Relinking (Fuzzy Match)
        // If IDs don't match but Names do, Spotify might have linked to a different version of the same track.
        const isFuzzyMatch =
          expectedTrack.tracks.name.toLowerCase() ===
          currentSpotifyTrack.name.toLowerCase()

        if (isFuzzyMatch) {
          // Update the queue manager with the NEW ID so future checks pass
          // We don't change the DB ID, but we make the QueueManager aware via setCurrentlyPlayingTrack
          // and potentially update our local reference
          queueManager.setCurrentlyPlayingTrack(currentSpotifyTrack.id)

          if (this.currentQueueTrack?.id === expectedTrack.id) {
            // Update our local tracking to avoid repeated fuzzy checks
            // We can't easily update the ID in the queue object without mutating it,
            // but strictly speaking satisfy the "sync" by just NOT calling playNextTrack.
          }

          return
        }

        void this.playNextTrack(expectedTrack)
        return
      }

      if (this.currentQueueTrack) {
        this.currentQueueTrack = null
      }
    }
  }

  isTrackFinished(state: PlayerSDKState): boolean {
    if (!this.lastKnownState) {
      return false
    }

    const lastTrack = this.lastKnownState.track_window?.current_track
    const currentTrack = state.track_window?.current_track

    if (!lastTrack || !currentTrack) {
      return false
    }

    if (lastTrack.uri !== currentTrack.uri) {
      return false
    }

    const trackJustFinished =
      !this.lastKnownState.paused &&
      state.paused &&
      state.position === 0 &&
      this.lastKnownState.position > 2000

    if (trackJustFinished) {
      return true
    }

    const wasNearEnd =
      this.lastKnownState.duration > 0 &&
      this.lastKnownState.position > this.lastKnownState.duration * 0.9

    const isNowNearStart = state.position < 3000

    if (wasNearEnd && isNowNearStart && !state.paused) {
      return true
    }

    const isNearEnd =
      state.duration > 0 &&
      state.duration - state.position <
        PLAYER_LIFECYCLE_CONFIG.TRACK_END_THRESHOLD_MS

    const positionUnchanged = state.position === this.lastKnownState.position
    const wasPlayingButNowPaused = !this.lastKnownState.paused && state.paused
    const timeSinceLastUpdate = Date.now() - this.lastStateUpdateTime

    const hasStalled =
      positionUnchanged &&
      wasPlayingButNowPaused &&
      timeSinceLastUpdate >
        PLAYER_LIFECYCLE_CONFIG.STATE_MONITORING.stallDetectionMs

    return isNearEnd && hasStalled
  }

  async handleRestrictionViolatedError(): Promise<void> {
    const currentTrack = this.currentQueueTrack
    if (!currentTrack) {
      return
    }

    if (playbackService.isOperationInProgress()) {
      return
    }

    await withErrorHandling(
      async () => {
        await queueManager.markAsPlayed(currentTrack.id)
        const nextTrack = queueManager.getNextTrack()
        this.currentQueueTrack = nextTrack ?? null
      },
      '[handleRestrictionViolatedError] Remove restricted track',
      this.getLogger()
    )
  }
}
