import { JukeboxQueueItem } from '@/shared/types/queue'
import { sendApiRequest } from '@/shared/api'
import { QueueManager } from '@/services/queueManager'
import { transferPlaybackToDevice } from '@/services/deviceManagement'
import { buildTrackUri } from '@/shared/utils/spotifyUri'
import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('TrackPlayer')

export class TrackPlayer {
  private deviceId: string | null = null
  private readonly queueManager: QueueManager
  private onNextTrackStarted?: (track: JukeboxQueueItem) => void

  constructor(
    queueManager: QueueManager,
    config: {
      deviceId?: string | null
      onNextTrackStarted?: (track: JukeboxQueueItem) => void
    } = {}
  ) {
    this.queueManager = queueManager
    this.deviceId = config.deviceId ?? null
    this.onNextTrackStarted = config.onNextTrackStarted
  }

  setDeviceId(deviceId: string | null): void {
    this.deviceId = deviceId
  }

  setOnNextTrackStarted(cb: (track: JukeboxQueueItem) => void): void {
    this.onNextTrackStarted = cb
  }

  async play(track: JukeboxQueueItem): Promise<void> {
    if (!this.deviceId) return

    await this.ensureDeviceActive()
    await this.guardDuplicate(track)
    await this.startPlayback(track)
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Transfers playback to the app's device with up to 2 retries and exponential
   * backoff. On final failure, verifies directly that the device is already active
   * before proceeding anyway (the transfer API is sometimes unreliable).
   */
  private async ensureDeviceActive(): Promise<void> {
    let transferred = false
    const maxRetries = 2

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        transferred = await transferPlaybackToDevice(this.deviceId!)
      } catch {
        transferred = false
      }

      if (transferred) return

      if (attempt < maxRetries) {
        await delay(1000 * (attempt + 1)) // 1s, 2s
      } else {
        // Final fallback: check if device is already active
        try {
          const state = await sendApiRequest<{
            device?: { id: string; is_active: boolean }
          }>({ path: 'me/player', method: 'GET' })

          if (state?.device?.id === this.deviceId && state.device.is_active) {
            return // Device already active — proceed
          }
        } catch {
          // Proceed anyway; if the device is truly not ready, startPlayback will fail
        }
      }
    }
  }

  /**
   * Checks whether the track is already playing. If so, marks it as played and
   * attempts to play the next queued track instead.
   */
  private async guardDuplicate(track: JukeboxQueueItem): Promise<void> {
    try {
      const state = await sendApiRequest<{
        item?: { id: string; name: string }
        is_playing: boolean
      }>({ path: 'me/player', method: 'GET' })

      if (
        state?.item?.id === track.tracks.spotify_track_id &&
        state.is_playing
      ) {
        try {
          await this.queueManager.markAsPlayed(track.id)
        } catch {}

        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          await this.play(nextTrack)
        }
        // Throw to abort the original play() call cleanly
        throw new DuplicateTrackError()
      }
    } catch (error) {
      if (error instanceof DuplicateTrackError) throw error
      // If verification fails, continue with playback
    }
  }

  /**
   * Issues the Spotify play command with one transient-error retry.
   * On persistent failure, removes the track from the queue and attempts the next.
   */
  private async startPlayback(track: JukeboxQueueItem): Promise<void> {
    const playPayload = {
      path: 'me/player/play' as const,
      method: 'PUT' as const,
      body: {
        device_id: this.deviceId,
        uris: [buildTrackUri(track.tracks.spotify_track_id)]
      }
    }

    try {
      await sendApiRequest(playPayload)
      this.queueManager.setCurrentlyPlayingTrack(track.tracks.spotify_track_id)
      this.onNextTrackStarted?.(track)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isTransient =
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT')

      if (isTransient) {
        await delay(1000)
        try {
          await sendApiRequest(playPayload)
          this.onNextTrackStarted?.(track)
          return
        } catch {}
      }

      // Remove problematic track and try next
      try {
        await this.queueManager.markAsPlayed(track.id)
        const nextTrack = this.queueManager.getNextTrack()
        if (nextTrack) {
          await this.play(nextTrack)
        }
      } catch {}
    }
  }
}

class DuplicateTrackError extends Error {
  constructor() {
    super('Track already playing')
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
