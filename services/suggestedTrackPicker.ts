// Weighted random selection over tracks that human users have suggested
// (suggested_tracks rows). Used by the auto-fill fallback so that when the AI
// can't supply tracks, the venue's own requests are recycled — favouring songs
// people ask for more often and more recently.

export const RECENCY_HALF_LIFE_DAYS = 30

// Even a very old suggestion keeps this fraction of its recency weight, so the
// long tail of the pool stays reachable.
const RECENCY_FLOOR = 0.1

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface SuggestedTrackCandidate<T> {
  track: T
  count: number
  lastSuggestedAt: string
}

/**
 * weight = frequency × recency
 *  - frequency: 1 + ln(count), so a track suggested 7 times is ~2.9× as likely
 *    as one suggested once, rather than 7× (a few favourites can't dominate).
 *  - recency: exponential decay on last_suggested_at with a 30-day half-life,
 *    floored so old suggestions are still possible.
 * Always > 0 for any input.
 */
export function suggestedTrackWeight(
  count: number,
  lastSuggestedAt: string,
  now: number = Date.now()
): number {
  const frequency = 1 + Math.log(Math.max(count, 1))

  const suggestedAtMs = new Date(lastSuggestedAt).getTime()
  const decay = Number.isFinite(suggestedAtMs)
    ? Math.pow(
        0.5,
        Math.max(0, now - suggestedAtMs) / MS_PER_DAY / RECENCY_HALF_LIFE_DAYS
      )
    : 0

  return frequency * (RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay)
}

/**
 * Picks one candidate at random, weighted by suggestedTrackWeight.
 * Returns null when there are no candidates. `rng` (0 <= r < 1) is injectable
 * for deterministic tests.
 */
export function pickWeightedSuggestedTrack<T>(
  candidates: Array<SuggestedTrackCandidate<T>>,
  rng: () => number = Math.random,
  now: number = Date.now()
): T | null {
  if (candidates.length === 0) return null

  const weights = candidates.map((c) =>
    suggestedTrackWeight(c.count, c.lastSuggestedAt, now)
  )
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)

  let roll = rng() * totalWeight
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]
    if (roll < 0) return candidates[i].track
  }
  return candidates[candidates.length - 1].track
}
