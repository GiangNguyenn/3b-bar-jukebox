// Timestamp-based track cooldown for preventing repeat suggestions within 24 hours

export interface SuggestionsCooldownState {
  trackTimestamps: Record<string, number> // spotifyTrackId -> timestamp
  updatedAt: number
  version: 2
}

const VERSION: SuggestionsCooldownState['version'] = 2
// 24 hours in milliseconds
const COOLDOWN_PERIOD_MS = 24 * 60 * 60 * 1000

function getKey(contextId: string): string {
  return `suggestions:cooldown:${contextId}`
}

export function loadCooldownState(contextId: string): SuggestionsCooldownState {
  if (typeof window === 'undefined') {
    return { trackTimestamps: {}, updatedAt: Date.now(), version: VERSION }
  }
  try {
    const raw = localStorage.getItem(getKey(contextId))
    if (!raw)
      return { trackTimestamps: {}, updatedAt: Date.now(), version: VERSION }
    const parsed = JSON.parse(raw) as any

    // Migrate from old version (v1) to new version (v2)
    if (parsed.version !== VERSION || !parsed.trackTimestamps) {
      return { trackTimestamps: {}, updatedAt: Date.now(), version: VERSION }
    }

    if (typeof parsed.trackTimestamps !== 'object') {
      return { trackTimestamps: {}, updatedAt: Date.now(), version: VERSION }
    }

    // Clean up old entries while loading
    const cleanedTimestamps = cleanOldEntries(parsed.trackTimestamps)

    return {
      trackTimestamps: cleanedTimestamps,
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      version: VERSION
    }
  } catch {
    return { trackTimestamps: {}, updatedAt: Date.now(), version: VERSION }
  }
}

export function saveCooldownState(
  contextId: string,
  state: SuggestionsCooldownState
): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(getKey(contextId), JSON.stringify(state))
  } catch {}
}

/**
 * Remove entries older than the cooldown period
 */
function cleanOldEntries(
  trackTimestamps: Record<string, number>
): Record<string, number> {
  const now = Date.now()
  const cutoff = now - COOLDOWN_PERIOD_MS
  const cleaned: Record<string, number> = {}

  for (const [trackId, timestamp] of Object.entries(trackTimestamps)) {
    if (timestamp > cutoff) {
      cleaned[trackId] = timestamp
    }
  }

  return cleaned
}

/**
 * Get track IDs that were added within the last 24 hours
 */
export function getTracksInCooldown(state: SuggestionsCooldownState): string[] {
  const now = Date.now()
  const cutoff = now - COOLDOWN_PERIOD_MS

  return Object.entries(state.trackTimestamps)
    .filter(([, timestamp]) => timestamp > cutoff)
    .map(([trackId]) => trackId)
}

/**
 * Filter out tracks that are still in cooldown period (added within last 24 hours)
 */
export function filterEligibleTrackIds(
  candidates: string[],
  state: SuggestionsCooldownState
): string[] {
  const tracksInCooldown = new Set(getTracksInCooldown(state))
  return candidates.filter((id) => !tracksInCooldown.has(id))
}

/**
 * Record that a track was added to the playlist
 */
export function recordTrackAddition(
  state: SuggestionsCooldownState,
  trackId: string
): SuggestionsCooldownState {
  if (!trackId) return state

  const cleanedTimestamps = cleanOldEntries(state.trackTimestamps)

  return {
    trackTimestamps: {
      ...cleanedTimestamps,
      [trackId]: Date.now()
    },
    updatedAt: Date.now(),
    version: VERSION
  }
}

/**
 * Get all track IDs currently in cooldown (for debugging/display purposes)
 */
export function getCooldownInfo(state: SuggestionsCooldownState): {
  count: number
  trackIds: string[]
  oldestTimestamp: number | null
  newestTimestamp: number | null
} {
  const tracksInCooldown = getTracksInCooldown(state)
  const timestamps = Object.values(state.trackTimestamps).filter(
    (ts) => ts > Date.now() - COOLDOWN_PERIOD_MS
  )

  return {
    count: tracksInCooldown.length,
    trackIds: tracksInCooldown,
    oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
    newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null
  }
}
