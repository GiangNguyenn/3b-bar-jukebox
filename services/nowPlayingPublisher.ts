import { supabaseBrowser } from '@/lib/supabase-browser'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('NowPlayingPublisher')

const REQUEST_TIMEOUT_MS = 10000
const RETRY_BASE_DELAY_MS = 2000
const RETRY_MAX_DELAY_MS = 15000

interface NowPlayingRowInput {
  profile_id: string
  spotify_track_id: string | null
  track_name: string | null
  artist_name: string | null
  album_name: string | null
  album_art_url: string | null
  duration_ms: number | null
  is_playing: boolean
  progress_ms: number
  updated_at: string
}

interface PublishedKey {
  trackId: string | null
  isPlaying: boolean
}

/**
 * The Supabase calls, behind an object so tests can replace them.
 * Both resolve rather than throw: `write` with an error message (or null on
 * success), `read` with the row's key (null when there is no row yet) or
 * `undefined` when the read itself failed.
 */
export const nowPlayingTransport = {
  async write(row: NowPlayingRowInput): Promise<string | null> {
    try {
      const { error } = await supabaseBrowser
        .from('now_playing')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(row as any, { onConflict: 'profile_id' })
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      return error ? error.message : null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },

  async read(profileId: string): Promise<PublishedKey | null | undefined> {
    try {
      const { data, error } = await supabaseBrowser
        .from('now_playing')
        .select('spotify_track_id, is_playing')
        .eq('profile_id', profileId)
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
        .maybeSingle<{ spotify_track_id: string | null; is_playing: boolean }>()
      if (error) return undefined
      if (!data) return null
      return { trackId: data.spotify_track_id, isPlaying: data.is_playing }
    } catch {
      return undefined
    }
  }
}

// What the now_playing row is known to hold (last confirmed write or read)
let confirmed: PublishedKey | null = null
// The latest state we have been asked to publish
let desired: { profileId: string; state: SpotifyPlaybackState | null } | null =
  null
let isWriting = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempts = 0

function keyOf(state: SpotifyPlaybackState | null): PublishedKey {
  return {
    trackId: state?.item?.id ?? null,
    isPlaying: state?.is_playing ?? false
  }
}

function sameKey(a: PublishedKey | null, b: PublishedKey): boolean {
  return a !== null && a.trackId === b.trackId && a.isPlaying === b.isPlaying
}

function buildRow(
  profileId: string,
  state: SpotifyPlaybackState | null
): NowPlayingRowInput {
  if (!state?.item?.id) {
    return {
      profile_id: profileId,
      spotify_track_id: null,
      track_name: null,
      artist_name: null,
      album_name: null,
      album_art_url: null,
      duration_ms: null,
      is_playing: false,
      progress_ms: 0,
      updated_at: new Date().toISOString()
    }
  }

  return {
    profile_id: profileId,
    spotify_track_id: state.item.id,
    track_name: state.item.name,
    artist_name: state.item.artists?.[0]?.name ?? '',
    album_name: state.item.album?.name ?? '',
    album_art_url: state.item.album?.images?.[0]?.url ?? '',
    duration_ms: state.item.duration_ms ?? 0,
    is_playing: state.is_playing ?? false,
    progress_ms: state.progress_ms ?? 0,
    updated_at: new Date().toISOString()
  }
}

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function scheduleRetry(): void {
  const delay = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** retryAttempts,
    RETRY_MAX_DELAY_MS
  )
  retryAttempts += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    void drain()
  }, delay)
}

/**
 * Writes the latest desired state, one request at a time. Writes are never
 * in flight concurrently, so an older state cannot land after a newer one,
 * and a state only counts as published once its write has succeeded.
 */
async function drain(): Promise<void> {
  if (isWriting) return
  clearRetry()
  isWriting = true

  try {
    while (desired) {
      const target = desired
      const key = keyOf(target.state)
      if (sameKey(confirmed, key)) break

      const error = await nowPlayingTransport.write(
        buildRow(target.profileId, target.state)
      )

      if (error) {
        logger(
          'ERROR',
          `Failed to publish now_playing (attempt ${retryAttempts + 1}), will retry: ${error}`
        )
        scheduleRetry()
        break
      }

      confirmed = key
      retryAttempts = 0
    }
  } finally {
    isWriting = false
  }
}

/**
 * Publishes the current playback state to the now_playing table in Supabase.
 * Only writes when the track or play/pause state actually changes, and
 * retries until the write succeeds or a newer state replaces it.
 */
export async function publishNowPlaying(
  profileId: string,
  state: SpotifyPlaybackState | null
): Promise<void> {
  desired = { profileId, state }
  await drain()
}

/**
 * Checks that the now_playing row still matches what the player is doing and
 * rewrites it if not. Called periodically so a stale row heals itself without
 * waiting for the next track change. A read costs no realtime messages, so
 * this stays cheap while nothing is wrong.
 */
export async function verifyNowPlaying(): Promise<void> {
  if (!desired || isWriting || retryTimer) return

  const target = desired
  const actual = await nowPlayingTransport.read(target.profileId)

  // Read failed, or a newer state / write took over while we were reading
  if (actual === undefined || desired !== target || isWriting || retryTimer) {
    return
  }

  const key = keyOf(target.state)
  if (actual !== null && sameKey(actual, key)) {
    confirmed = key
    return
  }

  logger(
    'WARN',
    `now_playing row is stale (row: ${actual?.trackId ?? 'none'}, player: ${key.trackId ?? 'none'}) — republishing`
  )
  confirmed = actual
  await drain()
}

/**
 * Resets the publisher's state. Useful when the player is destroyed.
 */
export function resetNowPlayingPublisher(): void {
  clearRetry()
  confirmed = null
  desired = null
  retryAttempts = 0
}
