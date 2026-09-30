/**
 * Turns the player's state into the two things someone diagnosing a silent
 * jukebox looks for first (see docs/remote-diagnostics.md):
 *
 * - a timeline: one line when a track starts, when playback pauses or
 *   resumes, and when a track ends with nothing following it;
 * - a single explicit "Playback stopped" error once the jukebox has been
 *   silent, when it should be playing, for STOPPED_AFTER_MS.
 *
 * Pure logic fed with samples; the wiring to the player store and the
 * uploader lives in ./instrumentation.ts.
 */
import { formatDuration } from '@/shared/utils/tabVisibility'

export interface PlaybackSample {
  /** Player status from the store ('ready', 'error', ...) */
  status: string
  lastError?: string
  trackId?: string
  trackName?: string
  artist?: string
  isPlaying: boolean
  positionMs: number
  durationMs: number
  /** When the SDK last reported the position above (epoch ms) */
  stateAt: number
  /** The owner paused from the jukebox UI */
  manualPause: boolean
  queueLength: number
  /** e.g. 'visible' or 'hidden for 14m 5s' */
  tab: string
}

export interface PlaybackWatchOptions {
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void
  /** Silence confirmed (detail) or over (null) */
  onStoppedChange?: (detail: string | null) => void
  now?: () => number
}

export const PLAYBACK_WATCH_CONFIG = {
  // A pause shorter than this is the gap between two tracks, not an event
  PAUSE_LOG_DELAY_MS: 3_000,
  STOPPED_AFTER_MS: 30_000,
  // Closer than this to the end, a paused track counts as finished
  END_MARGIN_MS: 3_000,
  // How long after a track should have ended, with no word from the SDK,
  // before concluding it is no longer playing
  OVERRUN_GRACE_MS: 30_000
} as const

// The store can still say "playing" for a moment after the player has been
// declared broken; other statuses ('verifying', ...) pass while music plays
const BROKEN_STATUSES: ReadonlySet<string> = new Set([
  'error',
  'disconnected',
  'recovery_needed'
])

interface TrackInfo {
  id: string
  name: string
  artist: string
  durationMs: number
}

interface Silence {
  since: number
  track: TrackInfo | null
  positionMs: number
  atEnd: boolean
  overrun: boolean
  logged: boolean
  reported: boolean
}

function formatPosition(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function describeTrack(track: TrackInfo | null): string {
  if (!track) return 'an unknown track'
  return `"${track.name}"${track.artist ? ` by ${track.artist}` : ''}`
}

export class PlaybackWatch {
  private readonly log: PlaybackWatchOptions['log']
  private readonly onStoppedChange: (detail: string | null) => void
  private readonly now: () => number

  // Only a jukebox that has been playing can be said to have stopped
  private armed = false
  private current: TrackInfo | null = null
  private startedAt = 0
  private lastPositionMs = 0
  private lastStateAt = 0
  private silence: Silence | null = null

  constructor(options: PlaybackWatchOptions) {
    this.log = options.log
    this.onStoppedChange = options.onStoppedChange ?? ((): void => {})
    this.now = options.now ?? ((): number => Date.now())
  }

  /** Call on every player state change, and every few seconds in between. */
  observe(sample: PlaybackSample): void {
    const now = this.now()
    const expectedEnd =
      sample.stateAt + Math.max(0, sample.durationMs - sample.positionMs)
    const overrun =
      sample.isPlaying &&
      sample.durationMs > 0 &&
      now > expectedEnd + PLAYBACK_WATCH_CONFIG.OVERRUN_GRACE_MS
    const playing =
      sample.isPlaying &&
      sample.trackId !== undefined &&
      !BROKEN_STATUSES.has(sample.status) &&
      !overrun

    if (playing) {
      this.handlePlaying(sample, now)
      return
    }

    if (sample.manualPause) {
      this.handleManualPause(sample)
      return
    }
    if (!this.armed) return

    if (!this.silence) {
      const positionMs = overrun
        ? sample.durationMs
        : sample.trackId === undefined
          ? this.estimatePosition(now)
          : sample.positionMs
      this.silence = {
        // Counted from now even for an overrun, which really went quiet
        // earlier: a stale position must not raise the alarm on the spot
        since: now,
        track: this.current,
        positionMs,
        atEnd:
          this.current !== null &&
          positionMs >=
            this.current.durationMs - PLAYBACK_WATCH_CONFIG.END_MARGIN_MS,
        overrun,
        logged: false,
        reported: false
      }
    }
    const silence = this.silence
    const silentMs = now - silence.since

    if (
      !silence.logged &&
      silentMs >= PLAYBACK_WATCH_CONFIG.PAUSE_LOG_DELAY_MS
    ) {
      silence.logged = true
      this.log(
        'INFO',
        silence.atEnd
          ? `Track ended: ${describeTrack(silence.track)} — nothing has started after it yet`
          : `Playback paused: ${describeTrack(silence.track)} at ${formatPosition(silence.positionMs)} of ${formatPosition(silence.track?.durationMs ?? 0)}, not requested from the jukebox`
      )
    }

    if (
      !silence.reported &&
      silentMs >= PLAYBACK_WATCH_CONFIG.STOPPED_AFTER_MS
    ) {
      silence.reported = true
      const detail = `${this.describeReason(sample, silence)}; player ${sample.status}, ${sample.queueLength} in queue, tab ${sample.tab}`
      this.log(
        'ERROR',
        `Playback stopped: silent for ${formatDuration(silentMs)} after ${describeTrack(silence.track)} — ${detail}`
      )
      this.onStoppedChange(detail)
    }
  }

  getSummary(): {
    lastTrack?: string
    lastTrackStartedAt?: string
    silentForSeconds?: number
    stopped: boolean
  } {
    return {
      lastTrack: this.current?.name,
      lastTrackStartedAt: this.startedAt
        ? new Date(this.startedAt).toISOString()
        : undefined,
      silentForSeconds: this.silence
        ? Math.round((this.now() - this.silence.since) / 1000)
        : undefined,
      stopped: this.silence?.reported ?? false
    }
  }

  private handlePlaying(sample: PlaybackSample, now: number): void {
    const track: TrackInfo = {
      id: sample.trackId ?? '',
      name: sample.trackName ?? 'unknown',
      artist: sample.artist ?? '',
      durationMs: sample.durationMs
    }
    const silence = this.silence
    this.silence = null
    this.armed = true
    this.lastPositionMs = sample.positionMs
    this.lastStateAt = sample.stateAt

    if (silence?.reported) {
      this.log(
        'WARN',
        `Playback resumed after ${formatDuration(now - silence.since)} of silence: ${describeTrack(track)}`
      )
      this.onStoppedChange(null)
    }

    if (this.current?.id !== track.id) {
      this.current = track
      this.startedAt = now
      this.log(
        'INFO',
        `Track started: ${describeTrack(track)} (${formatPosition(track.durationMs)})`
      )
    } else if (silence?.logged && !silence.reported) {
      this.log(
        'INFO',
        `Playback resumed: ${describeTrack(track)} at ${formatPosition(sample.positionMs)} after ${formatDuration(now - silence.since)}`
      )
    }
  }

  // The player state is cleared when the player is torn down; work out where
  // the track had got to from the last position the SDK reported.
  private estimatePosition(now: number): number {
    if (!this.current) return 0
    return Math.min(
      this.current.durationMs,
      this.lastPositionMs + Math.max(0, now - this.lastStateAt)
    )
  }

  private handleManualPause(sample: PlaybackSample): void {
    const wasReported = this.silence?.reported ?? false
    this.silence = null
    if (this.armed) {
      this.armed = false
      this.log(
        'INFO',
        `Playback paused from the jukebox: ${describeTrack(this.current)} at ${formatPosition(sample.positionMs)}`
      )
    }
    // Silence someone asked for is not an outage
    if (wasReported) this.onStoppedChange(null)
  }

  private describeReason(sample: PlaybackSample, silence: Silence): string {
    if (sample.status !== 'ready') {
      return `the player is '${sample.status}'${sample.lastError ? ` (${sample.lastError})` : ''}`
    }
    if (silence.overrun) {
      return 'the Spotify SDK has sent no event since the track should have ended'
    }
    if (silence.atEnd) {
      return sample.queueLength === 0
        ? 'the track ended and the queue is empty'
        : 'the track ended and the next one did not start'
    }
    return 'playback paused mid-track without a pause request'
  }
}
