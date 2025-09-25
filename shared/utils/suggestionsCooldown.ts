// Minimal localStorage-backed ring buffer for songs-between-repeats

export interface SuggestionsCooldownState {
  recentTrackIds: string[]
  updatedAt: number
  version: 1
}

const VERSION: SuggestionsCooldownState['version'] = 1

function getKey(contextId: string): string {
  return `suggestions:cooldown:${contextId}`
}

export function loadCooldownState(contextId: string): SuggestionsCooldownState {
  if (typeof window === 'undefined') {
    return { recentTrackIds: [], updatedAt: Date.now(), version: VERSION }
  }
  try {
    const raw = localStorage.getItem(getKey(contextId))
    if (!raw)
      return { recentTrackIds: [], updatedAt: Date.now(), version: VERSION }
    const parsed = JSON.parse(raw) as SuggestionsCooldownState
    if (!Array.isArray(parsed.recentTrackIds)) {
      return { recentTrackIds: [], updatedAt: Date.now(), version: VERSION }
    }
    return {
      recentTrackIds: parsed.recentTrackIds,
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      version: VERSION
    }
  } catch {
    return { recentTrackIds: [], updatedAt: Date.now(), version: VERSION }
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

export function filterEligibleTrackIds(
  candidates: string[],
  state: SuggestionsCooldownState,
  minBetween: number
): string[] {
  if (minBetween <= 0) return candidates
  const recent = new Set(state.recentTrackIds.slice(-minBetween))
  return candidates.filter((id) => !recent.has(id))
}

export function appendSuggestedTrackId(
  state: SuggestionsCooldownState,
  trackId: string,
  minBetween: number
): SuggestionsCooldownState {
  if (!trackId) return state
  const max = Math.max(0, minBetween)
  const nextIds = [...state.recentTrackIds, trackId]
  const trimmed = max > 0 ? nextIds.slice(-max) : nextIds
  return { recentTrackIds: trimmed, updatedAt: Date.now(), version: VERSION }
}
