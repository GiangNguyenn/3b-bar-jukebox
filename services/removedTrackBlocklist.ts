// Songs the admin has removed from the queue. For the rest of the browser
// session the auto-fill (AI and random fallback) must not put them back.
// Only system adds are affected — a person can still request a blocked song.
//
// Backed by sessionStorage (scoped to this tab, cleared when it closes) with an
// in-memory copy so it also works where storage is unavailable.

const STORAGE_KEY = 'jukebox-admin-removed-tracks'

// Bounds memory/storage and, more importantly, the size of the prompt sent to
// the AI, which lists blocked titles so it doesn't suggest them.
const MAX_ENTRIES = 200

export interface RemovedTrack {
  id: string // Spotify track ID
  title: string
  artist: string
}

let entries: RemovedTrack[] | null = null

function load(): RemovedTrack[] {
  if (entries) return entries
  entries = []
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (e): e is RemovedTrack =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as RemovedTrack).id === 'string'
        )
      }
    }
  } catch {
    // Storage unavailable or corrupt: start empty
  }
  return entries
}

function persist(): void {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Non-critical: the in-memory copy still applies for this page load
  }
}

/** Records a removed track (most recent last). Re-blocking refreshes recency. */
export function blockRemovedTrack(track: RemovedTrack): void {
  if (!track.id) return
  const list = load().filter((e) => e.id !== track.id)
  list.push({ id: track.id, title: track.title, artist: track.artist })
  entries = list.slice(-MAX_ENTRIES)
  persist()
}

/** Undoes blockRemovedTrack, e.g. when the removal it was recorded for failed. */
export function unblockTrack(spotifyTrackId: string): void {
  entries = load().filter((e) => e.id !== spotifyTrackId)
  persist()
}

export function getBlockedTrackIds(): string[] {
  return load().map((e) => e.id)
}

/** The most recently blocked tracks, newest last. */
export function getBlockedTracks(limit = MAX_ENTRIES): RemovedTrack[] {
  return load().slice(-limit)
}

export function isTrackBlocked(spotifyTrackId: string): boolean {
  return load().some((e) => e.id === spotifyTrackId)
}

/** Test helper: forgets everything, in memory and in sessionStorage. */
export function clearBlockedTracks(): void {
  entries = []
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
