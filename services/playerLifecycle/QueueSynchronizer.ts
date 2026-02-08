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
    ) => {
      this.controller.log(
        level,
        `${context ? `[${context}] ` : ''}${message}`,
        error
      )
    }
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
      this.controller.log('ERROR', 'No device ID available to play next track')
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

      this.controller.log(
        'INFO',
        `[playNextTrack] Attempt ${attempts}/${MAX_ATTEMPTS} - Track: ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id}), Queue ID: ${currentTrack.id}`
      )

      if (lastPlayingTrackId) {
        const validTrack = await ensureTrackNotDuplicate(
          currentTrack,
          lastPlayingTrackId,
          PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.duplicateCheckRetries,
          this.getLogger()
        )

        if (!validTrack) {
          this.controller.log(
            'WARN',
            `Track ${currentTrack?.tracks.name ?? 'unknown'} is a duplicate, queue exhausted or removal failed`
          )
          break
        }

        currentTrack = validTrack
      }

      const trackUri = buildTrackUri(currentTrack.tracks.spotify_track_id)

      this.controller.log(
        'INFO',
        `[playNextTrack] Attempting to play track URI: ${trackUri} on device: ${deviceId}`
      )

      const success = await this.controller.playTrackWithRetry(
        trackUri,
        deviceId,
        PLAYER_LIFECYCLE_CONFIG.PLAYBACK_RETRY.maxRetriesPerTrack
      )

      if (success) {
        if (!currentTrack) {
          this.controller.log(
            'ERROR',
            '[playNextTrack] Current track became null unexpectedly'
          )
          return
        }

        this.controller.log(
          'INFO',
          `[playNextTrack] Successfully started playback of track: ${currentTrack.tracks.name} (${currentTrack.tracks.spotify_track_id})`
        )

        const trackIdForUpsert = currentTrack.tracks.spotify_track_id
        void upsertPlayedTrack(trackIdForUpsert).catch((error) =>
          this.controller.log(
            'ERROR',
            `Failed to upsert played track ${trackIdForUpsert}`,
            error
          )
        )

        this.currentQueueTrack = currentTrack
        queueManager.setCurrentlyPlayingTrack(
          currentTrack.tracks.spotify_track_id
        )
        return
      }

      this.controller.log(
        'WARN',
        `[playNextTrack] Failed to play track ${currentTrack?.tracks.name ?? 'unknown'} (${currentTrack?.tracks.spotify_track_id ?? 'unknown'}) after retries. Queue ID: ${currentTrack?.id ?? 'unknown'}. Trying next track.`
      )

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
      this.controller.log(
        'ERROR',
        `[playNextTrack] Maximum attempts (${MAX_ATTEMPTS}) reached. Stopping track playback attempts.`
      )
    } else if (!currentTrack) {
      this.controller.log(
        'WARN',
        '[playNextTrack] No more tracks available in queue'
      )
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
          this.controller.log(
            'INFO',
            `[markFinishedTrackAsPlayed] Marking queue item as played - Queue ID: ${finishedQueueItem.id}, Track: ${finishedQueueItem.tracks.name}`
          )
          await queueManager.markAsPlayed(finishedQueueItem.id)
          this.controller.log(
            'INFO',
            `[markFinishedTrackAsPlayed] Successfully marked queue item as played: ${finishedQueueItem.id}`
          )
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

        this.controller.log(
          'INFO',
          `[markFinishedTrackAsPlayed] PLAYBACK SYNC: Handling Track Relinking/ID Mismatch.
           Finished Track ID: ${trackId}
           Matched Queue Item: ${validMatch.tracks.name} (${validMatch.tracks.spotify_track_id})
           Reason: Name match ("${trackName}")
           Action: Removing matched item from queue.`
        )

        await withErrorHandling(
          async () => {
            await queueManager.markAsPlayed(validMatch.id)
            this.controller.log(
              'INFO',
              `[markFinishedTrackAsPlayed] Successfully removed fuzzy-matched item: ${validMatch.id}`
            )
          },
          '[markFinishedTrackAsPlayed] Fuzzy removal',
          this.getLogger()
        )
      } else {
        this.controller.log(
          'WARN',
          `[markFinishedTrackAsPlayed] No queue item found for finished track: ${trackId} (${trackName}). 
           Queue length: ${queue.length}
           Queue items: ${JSON.stringify(
             queue.map((i) => `${i.tracks.name} (${i.tracks.spotify_track_id})`)
           )}`
        )
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
        this.controller.log(
          'WARN',
          `[findNextValidTrack] Using alternative track ${alternativeTrack.id} after duplicate detection failure`
        )
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
    await playbackService.executePlayback(
      () => this.handleTrackFinishedImpl(state),
      'handleTrackFinished'
    )
  }

  private async handleTrackFinishedImpl(state: PlayerSDKState): Promise<void> {
    const currentTrack = state.track_window?.current_track
    if (!currentTrack?.id) {
      this.controller.log(
        'WARN',
        '[handleTrackFinished] Track finished but no track ID available'
      )
      return
    }

    const currentSpotifyTrackId = currentTrack.id
    const currentTrackName = currentTrack.name || 'Unknown'

    this.controller.log(
      'INFO',
      `[handleTrackFinished] Track finished - ID: ${currentSpotifyTrackId}, Name: ${currentTrackName}, Position: ${state.position}, Duration: ${state.duration}
       State Debug: Paused=${state.paused}, Position=${state.position}, Duration=${state.duration}`
    )

    if (!this.duplicateDetector.shouldProcessTrack(currentSpotifyTrackId)) {
      this.duplicateDetector.setLastKnownPlayingTrack(currentSpotifyTrackId)
      this.controller.log(
        'INFO',
        `[handleTrackFinished] Skipping duplicate processing for track: ${currentSpotifyTrackId}`
      )
      return
    }

    await this.markFinishedTrackAsPlayed(
      currentSpotifyTrackId,
      currentTrackName
    )

    queueManager.setCurrentlyPlayingTrack(null)

    const nextTrack = await this.findNextValidTrack(currentSpotifyTrackId)

    if (nextTrack) {
      this.currentQueueTrack = nextTrack
      this.controller.log(
        'INFO',
        `[handleTrackFinished] Playing next track: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id}), Queue ID: ${nextTrack.id}`
      )
      await this.playNextTrackImpl(nextTrack)
    } else {
      this.currentQueueTrack = null
      this.controller.log(
        'WARN',
        '[handleTrackFinished] No next track available after track finished. Playback will stop.'
      )
    }
  }

  syncQueueWithPlayback(state: PlayerSDKState): void {
    if (playbackService.isOperationInProgress()) {
      this.controller.log(
        'WARN',
        '[syncQueueWithPlayback] Playback operation in progress - state will sync after completion'
      )
      return
    }

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

    const queue = queueManager.getQueue()
    const matchingQueueItem = queue.find(
      (item) => item.tracks.spotify_track_id === currentSpotifyTrack.id
    )

    if (matchingQueueItem) {
      if (this.currentQueueTrack?.id !== matchingQueueItem.id) {
        this.controller.log(
          'INFO',
          `Syncing queue: Current track changed from ${
            this.currentQueueTrack?.id ?? 'none'
          } to ${matchingQueueItem.id}`
        )
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
          this.controller.log(
            'INFO',
            `[syncQueueWithPlayback] Detected Track Relinking/Fuzzy Match.
             Expected: ${expectedTrack.tracks.name} (${expectedTrack.tracks.spotify_track_id})
             Playing: ${currentSpotifyTrack.name} (${currentSpotifyTrack.id})
             Action: Updating internal state to match playing track.`
          )

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

        this.controller.log(
          'WARN',
          `[syncQueueWithPlayback] Enforcing queue order: Track ${currentSpotifyTrack.name} (${currentSpotifyTrack.id}) is playing but not in queue. Jukebox expected: ${expectedTrack.tracks.name}`
        )

        void this.playNextTrack(expectedTrack)
        return
      }

      if (this.currentQueueTrack) {
        this.controller.log(
          'WARN',
          `Playing track ${currentSpotifyTrack.id} not found in queue - clearing queue reference`
        )
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
      this.controller.log(
        'INFO',
        '[isTrackFinished] Detected clean track finish (paused at 0)'
      )
      return true
    }

    const wasNearEnd =
      this.lastKnownState.duration > 0 &&
      this.lastKnownState.position > this.lastKnownState.duration * 0.9

    const isNowNearStart = state.position < 3000

    if (wasNearEnd && isNowNearStart && !state.paused) {
      this.controller.log(
        'WARN',
        `[isTrackFinished] Detected track wrap-around (seamless repeat). Last pos: ${this.lastKnownState.position}, New pos: ${state.position}. Forcing track finish.`
      )
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
      this.controller.log(
        'WARN',
        'No current track found, cannot remove problematic track'
      )
      return
    }

    if (playbackService.isOperationInProgress()) {
      this.controller.log(
        'WARN',
        '[syncQueueWithPlayback] Playback operation in progress - state will sync after completion'
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
      this.getLogger()
    )
  }
}
