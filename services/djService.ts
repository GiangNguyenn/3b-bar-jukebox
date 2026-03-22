import type { JukeboxQueueItem } from '@/shared/types/queue'
import { SpotifyApiService } from '@/services/spotifyApi'
import { DJ_VOICE_IDS, DEFAULT_DJ_VOICE } from '@/shared/constants/djVoices'

export type DJFrequency = 'never' | 'rarely' | 'sometimes' | 'often' | 'always'

export const FREQUENCY_MAP: Record<DJFrequency, number> = {
  never: 0,
  rarely: 0.1,
  sometimes: 0.25,
  often: 0.5,
  always: 1.0
}

interface PrefetchState {
  trackId: string
  promise: Promise<Blob | null>
}

// Global in-flight fetch guard: maps trackId → active fetch promise.
// Prevents duplicate Venice API calls if onTrackStarted or maybeAnnounce
// is triggered more than once for the same track.
const inFlightFetches = new Map<string, Promise<Blob | null>>()

const log = (...args: unknown[]) =>
  console.log('%c[DJService]', 'color: #a78bfa; font-weight: bold', ...args)
const warn = (...args: unknown[]) => console.warn('[DJService]', ...args)
const err = (...args: unknown[]) => console.error('[DJService]', ...args)

const RECENT_SCRIPTS_MAX = 5

class DJService {
  private static instance: DJService
  private prefetchState: PrefetchState | null = null
  private recentScripts: string[] = []
  private isAnnouncementInProgress: boolean = false

  private constructor() {}

  static getInstance(): DJService {
    if (!DJService.instance) {
      DJService.instance = new DJService()
    }
    return DJService.instance
  }

  isEnabled(): boolean {
    return localStorage.getItem('djMode') === 'true'
  }

  setEnabled(enabled: boolean): void {
    localStorage.setItem('djMode', String(enabled))
  }

  getFrequency(): DJFrequency {
    const stored = localStorage.getItem('djFrequency') as DJFrequency | null
    if (stored && stored in FREQUENCY_MAP) {
      return stored
    }
    return 'sometimes'
  }

  setFrequency(freq: DJFrequency): void {
    localStorage.setItem('djFrequency', freq)
  }

  isDuckOverlayEnabled(): boolean {
    return localStorage.getItem('duckOverlayMode') === 'true'
  }

  setDuckOverlay(enabled: boolean): void {
    localStorage.setItem('duckOverlayMode', String(enabled))
  }

  invalidatePrefetch(): void {
    if (this.prefetchState !== null) {
      log(
        'invalidatePrefetch — discarding stale prefetch due to language change'
      )
      this.prefetchState = null
    }
  }

  private playAudioBlob(
    blob: Blob,
    waitForEnd: boolean,
    restoreVolume: number | null
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        if (waitForEnd) resolve()
        if (restoreVolume !== null) {
          log(`audio ended — ramping volume back to ${restoreVolume}%`)
          this.rampVolume(restoreVolume, 2000)
        }
      }
      audio.onerror = (e) => {
        URL.revokeObjectURL(url)
        warn('audio playback error', e)
        if (waitForEnd) reject(e)
        if (restoreVolume !== null) {
          SpotifyApiService.getInstance()
            .setVolume(restoreVolume)
            .catch(() => {})
        }
      }
      audio.play().catch((e) => {
        warn('audio.play() rejected', e)
        if (waitForEnd) reject(e)
        if (restoreVolume !== null) {
          SpotifyApiService.getInstance()
            .setVolume(restoreVolume)
            .catch(() => {})
        }
      })

      if (!waitForEnd) resolve()
    })
  }

  private rampVolume(targetVolume: number, durationMs: number): void {
    const STEP_MS = 200
    const steps = Math.max(1, Math.floor(durationMs / STEP_MS))
    SpotifyApiService.getInstance()
      .getPlaybackState()
      .then((state) => {
        const currentVolume =
          state?.device?.volume_percent ?? Math.round(targetVolume * 0.5)
        const increment = (targetVolume - currentVolume) / steps
        let current = currentVolume
        let step = 0
        const interval = setInterval(() => {
          step++
          current += increment
          const clamped = Math.round(Math.max(0, Math.min(100, current)))
          SpotifyApiService.getInstance()
            .setVolume(clamped)
            .catch(() => {})
          if (step >= steps) {
            clearInterval(interval)
            SpotifyApiService.getInstance()
              .setVolume(targetVolume)
              .catch(() => {})
            log(`volume ramp complete → ${targetVolume}%`)
          }
        }, STEP_MS)
      })
      .catch(() => {
        SpotifyApiService.getInstance()
          .setVolume(targetVolume)
          .catch(() => {})
      })
  }

  private fetchAudioBlob(
    trackName: string,
    artistName: string,
    trackId?: string
  ): Promise<Blob | null> {
    // Deduplicate: if a fetch is already in-flight for this track, reuse it
    if (trackId && inFlightFetches.has(trackId)) {
      log(`fetchAudioBlob — reusing in-flight fetch for trackId=${trackId}`)
      return inFlightFetches.get(trackId)!
    }

    const promise = this._doFetchAudioBlob(trackName, artistName)

    if (trackId) {
      inFlightFetches.set(trackId, promise)
      promise.finally(() => inFlightFetches.delete(trackId))
    }

    return promise
  }

  private async _doFetchAudioBlob(
    trackName: string,
    artistName: string
  ): Promise<Blob | null> {
    const rawLang = localStorage.getItem('djLanguage')
    const language: 'english' | 'vietnamese' =
      rawLang === 'vietnamese' ? 'vietnamese' : 'english'
    const rawVoice = localStorage.getItem('djVoice')
    const resolvedVoice =
      typeof rawVoice === 'string' && DJ_VOICE_IDS.includes(rawVoice)
        ? rawVoice
        : DEFAULT_DJ_VOICE
    try {
      const scriptRes = await fetch('/api/dj-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackName,
          artistName,
          recentScripts: this.recentScripts,
          language
        })
      })
      if (!scriptRes.ok) {
        warn(`/api/dj-script ${scriptRes.status}`)
        return null
      }
      const data = (await scriptRes.json()) as { script?: string }
      if (!data.script) {
        warn('empty script returned')
        return null
      }
      log(`DJ script (${language}): "${data.script}"`)
      // Track recent scripts to avoid repetition
      this.recentScripts = [data.script, ...this.recentScripts].slice(
        0,
        RECENT_SCRIPTS_MAX
      )
      const ttsRes = await fetch('/api/dj-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.script, language, voice: resolvedVoice })
      })
      if (!ttsRes.ok) {
        warn(`/api/dj-tts ${ttsRes.status}`)
        return null
      }
      const blob = await ttsRes.blob()
      log(`fetch complete — blob ${blob.size} bytes`)
      return blob
    } catch (e) {
      err('fetch failed', e)
      return null
    }
  }

  onTrackStarted(
    _currentTrack: JukeboxQueueItem,
    nextTrack: JukeboxQueueItem | null
  ): void {
    const enabled = localStorage.getItem('djMode') === 'true'
    const freqRaw = localStorage.getItem('djFrequency') as DJFrequency | null
    const freq: DJFrequency =
      freqRaw && freqRaw in FREQUENCY_MAP ? freqRaw : 'sometimes'
    const roll = Math.random()
    const threshold = FREQUENCY_MAP[freq]

    log(
      `onTrackStarted | enabled=${enabled} freq=${freq} roll=${roll.toFixed(2)} threshold=${threshold} next="${nextTrack?.tracks?.name ?? 'none'}"`
    )

    if (!enabled || roll >= threshold) {
      log(
        `→ skipping prefetch (${!enabled ? 'DJ disabled' : `roll ${roll.toFixed(2)} ≥ ${threshold}`})`
      )
      this.prefetchState = null
      return
    }

    if (!nextTrack) {
      log('→ skipping prefetch (no next track)')
      return
    }

    const trackName = nextTrack.tracks?.name
    const artistName = nextTrack.tracks?.artist
    if (!trackName || !artistName) {
      log(
        `→ skipping prefetch (missing metadata: name="${trackName}" artist="${artistName}")`
      )
      return
    }

    // Already prefetching (or prefetched) for this exact track — nothing to do
    if (this.prefetchState?.trackId === nextTrack.id) {
      log(
        `→ prefetch already exists for "${trackName}" (id=${nextTrack.id}), skipping`
      )
      return
    }

    log(
      `→ prefetching for "${trackName}" by ${artistName} (id=${nextTrack.id})`
    )
    this.prefetchState = {
      trackId: nextTrack.id,
      promise: this.fetchAudioBlob(trackName, artistName, nextTrack.id)
    }
  }

  async maybeAnnounce(nextTrack: JukeboxQueueItem): Promise<void> {
    const enabled = localStorage.getItem('djMode') === 'true'
    if (!enabled) {
      log('maybeAnnounce | DJ disabled, skipping')
      return
    }

    // Guard: never run two announcements concurrently
    if (this.isAnnouncementInProgress) {
      log('maybeAnnounce | announcement already in progress, skipping')
      return
    }

    const trackName = nextTrack.tracks?.name
    const artistName = nextTrack.tracks?.artist
    if (!trackName || !artistName) {
      log(
        `maybeAnnounce | missing metadata (name="${trackName}" artist="${artistName}"), skipping`
      )
      return
    }

    log(
      `maybeAnnounce | trackId=${nextTrack.id} prefetch=${this.prefetchState ? `id=${this.prefetchState.trackId}` : 'null'} track="${trackName}"`
    )

    let audioBlob: Blob | null = null

    // Use prefetched audio if available and matches
    if (
      this.prefetchState !== null &&
      nextTrack.id === this.prefetchState.trackId
    ) {
      log('→ using prefetched audio')
      const { promise } = this.prefetchState
      this.prefetchState = null
      audioBlob = await promise
    } else {
      // No prefetch ready — skip the DJ rather than blocking the transition
      // with a live fetch. The next track will play immediately.
      if (this.prefetchState !== null) {
        log(
          `→ stale prefetch (prefetch=${this.prefetchState.trackId} ≠ next=${nextTrack.id}), discarding`
        )
        this.prefetchState = null
      }
      log('→ no prefetch available, skipping DJ to avoid delay')
      return
    }

    if (audioBlob === null) {
      log('→ audio blob is null, skipping')
      return
    }

    const duckOverlay = this.isDuckOverlayEnabled()
    log(`→ playing audio (duck=${duckOverlay})`)

    this.isAnnouncementInProgress = true
    try {
      if (duckOverlay) {
        let originalVolume = 100
        try {
          const state = await SpotifyApiService.getInstance().getPlaybackState()
          originalVolume = state?.device?.volume_percent ?? 100
        } catch {
          warn('could not read current volume, assuming 100%')
        }
        const duckedVolume = Math.round(originalVolume * 0.2)
        log(`duck: ${originalVolume}% → ${duckedVolume}%`)
        await SpotifyApiService.getInstance()
          .setVolume(duckedVolume)
          .catch((e) => warn('setVolume failed', e))
        // Re-apply duck after Spotify's play command may reset volume
        setTimeout(() => {
          SpotifyApiService.getInstance()
            .setVolume(duckedVolume)
            .catch(() => {})
        }, 500)
        await this.playAudioBlob(audioBlob, false, originalVolume)
      } else {
        await this.playAudioBlob(audioBlob, true, null)
      }
    } catch (e) {
      err('unexpected error during playback', e)
    } finally {
      this.isAnnouncementInProgress = false
    }
  }
}

export const djService = DJService.getInstance()
export { DJService }
