import { JukeboxQueueItem } from '@/shared/types/queue'
import { sendApiRequest } from '@/shared/api'
import { QueueManager } from '@/services/queueManager'
import { LogLevel } from '@/hooks/ConsoleLogsProvider'
import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('QueueAutoFiller')

type LogFn = (level: LogLevel, message: string, context?: string, error?: Error) => void

interface AutoFillNotificationMetadata {
  trackName: string
  artistName: string
  albumName?: string
  albumArtUrl?: string | null
  allArtists?: string[]
  durationMs?: number
  popularity?: number
  explicit?: boolean | null
  isFallback?: boolean
}

export class QueueAutoFiller {
  private isAutoFilling = false
  private autoFillDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastAutoFillCompletionTime = 0

  private username: string | null = null
  private activePrompt = ''
  private autoFillTargetSize: number
  private readonly autoFillMaxAttempts: number
  private onQueueLow?: () => void
  private addLog: LogFn | null = null
  private readonly queueManager: QueueManager

  constructor(
    queueManager: QueueManager,
    config: {
      autoFillTargetSize?: number
      autoFillMaxAttempts?: number
      onQueueLow?: () => void
    } = {}
  ) {
    this.queueManager = queueManager
    this.autoFillTargetSize = config.autoFillTargetSize ?? 10
    this.autoFillMaxAttempts = config.autoFillMaxAttempts ?? 20
    this.onQueueLow = config.onQueueLow
  }

  setUsername(username: string | null): void {
    this.username = username
  }

  setActivePrompt(prompt: string): void {
    if (this.addLog) {
      this.addLog(
        'INFO',
        `[PROMPT-UPDATE] "${this.activePrompt.slice(0, 40)}" → "${prompt.slice(0, 40)}"`,
        'QueueAutoFiller'
      )
    }
    this.activePrompt = prompt
  }

  setAutoFillTargetSize(size: number): void {
    this.autoFillTargetSize = size
  }

  setLogger(logger: LogFn): void {
    this.addLog = logger
  }

  /**
   * Debounced entry point. Coalesces rapid calls into a single check.
   */
  schedule(delayMs = 500): void {
    if (this.autoFillDebounceTimer) return // Already pending
    this.autoFillDebounceTimer = setTimeout(() => {
      this.autoFillDebounceTimer = null
      void this.check()
    }, delayMs)
  }

  /**
   * Refreshes queue from the API and returns the new length, or null on failure.
   * Exposed so callers (e.g. after marking a track played) can sync queue state.
   */
  async refreshQueue(): Promise<number | null> {
    if (!this.username) return null

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      let response: Response
      try {
        response = await fetch(`/api/playlist/${this.username}`, {
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) return null

      const queue = (await response.json()) as JukeboxQueueItem[]
      this.queueManager.updateQueue(queue)
      return queue.length
    } catch {
      return null
    }
  }

  /**
   * Checks whether the queue is below the target size and triggers auto-fill if so.
   * Protected by an atomic guard and a 15-second cooldown.
   */
  async check(): Promise<void> {
    if (this.isAutoFilling) return

    const now = Date.now()
    if (now - this.lastAutoFillCompletionTime < 15000) return

    this.isAutoFilling = true
    try {
      const cachedLength = this.queueManager.getQueue().length
      const freshLength = await this.refreshQueue()
      const currentLength = freshLength ?? cachedLength

      if (currentLength < this.autoFillTargetSize && this.username) {
        this.onQueueLow?.()
        await this.fill()
      }
    } catch {
      // Silently handle errors
    } finally {
      this.isAutoFilling = false
      this.lastAutoFillCompletionTime = Date.now()
      if (this.autoFillDebounceTimer) {
        clearTimeout(this.autoFillDebounceTimer)
        this.autoFillDebounceTimer = null
      }
    }
  }

  private async fill(): Promise<void> {
    if (!this.username || !this.activePrompt) {
      if (this.addLog) {
        this.addLog(
          'WARN',
          `[SOURCE:NONE] Auto-fill skipped: username=${!!this.username}, activePrompt="${this.activePrompt?.slice(0, 50) || ''}"`,
          'QueueAutoFiller'
        )
      }
      return
    }

    if (this.addLog) {
      this.addLog(
        'INFO',
        `[SOURCE:AI] Starting auto-fill with prompt: "${this.activePrompt.slice(0, 60)}..."`,
        'QueueAutoFiller'
      )
    }

    let tracksAdded = 0
    const currentQueue = this.queueManager.getQueue()
    const excludedTrackIds = currentQueue.map((item) => item.tracks.spotify_track_id)
    const queuedTracks = currentQueue.map((item) => ({
      title: item.tracks.name,
      artist: item.tracks.artist
    }))

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
            queuedTracks,
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
            'QueueAutoFiller'
          )
        }
        await this.fallback()
        return
      }

      const result = (await response.json()) as {
        success: boolean
        tracks: Array<{ id: string; title: string; artist: string }>
        error?: string
        recentlyPlayedCount?: number
        recentlyPlayed?: string[]
      }

      if (this.addLog) {
        this.addLog(
          'INFO',
          `[RECENTLY-PLAYED] ${result.recentlyPlayedCount ?? 0} tracks excluded: ${result.recentlyPlayed?.join(', ') || 'none'}`,
          'QueueAutoFiller'
        )
      }

      if (!result.success || !result.tracks || result.tracks.length === 0) {
        if (this.addLog) {
          this.addLog(
            'WARN',
            `[SOURCE:AI] AI returned no tracks: ${result.error || 'unknown'}. Falling back to random track.`,
            'QueueAutoFiller'
          )
        }
        await this.fallback()
        return
      }

      if (this.addLog) {
        this.addLog(
          'INFO',
          `[SOURCE:AI] Received ${result.tracks.length} tracks from AI, adding all to queue`,
          'QueueAutoFiller'
        )
      }

      for (const track of result.tracks) {
        try {
          if (this.addLog) {
            this.addLog(
              'INFO',
              `[SOURCE:AI] Adding AI track: "${track.title}" by ${track.artist} (${track.id})`,
              'QueueAutoFiller'
            )
          }
          await this.addTrack(track.id)
          tracksAdded++
        } catch (error) {
          if (this.addLog) {
            this.addLog(
              'ERROR',
              `[SOURCE:AI] Failed to add AI track ${track.title} to queue`,
              'QueueAutoFiller',
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
          'QueueAutoFiller',
          error instanceof Error ? error : undefined
        )
      }
      await this.fallback()
    }

    if (this.addLog) {
      this.addLog(
        'INFO',
        `[SOURCE:AI] Auto-fill complete. Added ${tracksAdded} tracks total`,
        'QueueAutoFiller'
      )
    }
  }

  private async addTrack(spotifyTrackId: string): Promise<void> {
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
      if (playlistResponse.status === 409) return // Already in playlist
      throw new Error(`Failed to add track to playlist: ${playlistResponse.status}`)
    }

    const albumArtUrl =
      trackDetails.album.images.length > 0
        ? (trackDetails.album.images[0]?.url ?? null)
        : null

    this.notify({
      trackName: trackDetails.name,
      artistName: trackDetails.artists[0]?.name ?? 'Unknown Artist',
      albumName: trackDetails.album.name,
      albumArtUrl,
      allArtists: trackDetails.artists.map((a) => a.name),
      durationMs: trackDetails.duration_ms,
      popularity: trackDetails.popularity,
      explicit: trackDetails.explicit,
      isFallback: false
    })
  }

  private async fallback(): Promise<boolean> {
    if (!this.username) return false

    if (this.addLog) {
      this.addLog('WARN', '[SOURCE:FALLBACK] Falling back to random track from database', 'QueueAutoFiller')
    }

    const excludedTrackIds = this.queueManager.getQueue().map((item) => item.tracks.spotify_track_id)

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        let response: Response
        try {
          response = await fetch('/api/random-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: this.username, excludedTrackIds }),
            signal: controller.signal
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) {
          if (response.status === 404) return false
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

        if (!result.success || !result.track) return false

        if (excludedTrackIds.includes(result.track.spotify_track_id)) continue

        const playlistController = new AbortController()
        const playlistTimeoutId = setTimeout(() => playlistController.abort(), 10000)
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
          if (playlistResponse.status === 409) continue
          return false
        }

        this.notify({
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
            'QueueAutoFiller'
          )
        }
        return true
      } catch (error) {
        if (this.addLog) {
          this.addLog(
            'ERROR',
            'Fallback to random track failed',
            'QueueAutoFiller',
            error instanceof Error ? error : undefined
          )
        }
      }
    }
    return false
  }

  private notify(metadata: AutoFillNotificationMetadata): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('autoFillNotification', {
        detail: {
          trackName: metadata.trackName,
          artistName: metadata.artistName,
          albumName: metadata.albumName,
          albumArtUrl: metadata.albumArtUrl ?? null,
          allArtists: metadata.allArtists ?? [metadata.artistName],
          durationMs: metadata.durationMs,
          popularity: metadata.popularity,
          explicit: metadata.explicit ?? null,
          isFallback: metadata.isFallback ?? false,
          timestamp: Date.now()
        }
      })
    )
  }
}
