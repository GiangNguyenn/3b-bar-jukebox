import type { DgsOptionTrack, ExplorationPhase } from './dgsTypes'

// --- Constants ---

export const MAX_ROUND_TURNS = 10
export const DISPLAY_OPTION_COUNT = 9
export const MIN_CANDIDATE_POOL = 100
export const MAX_CANDIDATE_POOL = 100
export const MIN_UNIQUE_ARTISTS = 100

export const GRAVITY_LIMITS = {
  min: 0.15,
  max: 0.7
}

export const UNDERDOG_CONFIG = {
  triggerHigh: 0.5,
  triggerLow: 0.25,
  bonus: 0.05
}

export const VICINITY_DISTANCE_THRESHOLD = 0.05
export const OG_CONSTANT = 0.12

export const CATEGORY_WEIGHTS = {
  closer: 0.34, // Balanced probability for fallback filling
  neutral: 0.33,
  further: 0.33
}

export const GUARANTEED_MINIMUMS = {
  closer: 3, // Force 3 closer tracks
  neutral: 3, // Force 3 neutral tracks
  further: 3 // Force 3 further tracks
}

export const MIN_QUALITY_THRESHOLDS = {
  closer: 0.15, // Minimum attraction improvement
  neutral: 0.05, // Minimum balance maintenance
  further: -0.1 // Maximum acceptable regression
}

export const DIVERSITY_SOURCES = {
  directRecommendations: 0.3, // 30% direct Spotify recommendations
  relatedArtists: 0.3, // 30% related artist tracks
  genreNeighbors: 0.2, // 20% genre-adjacent artists
  popularityVaried: 0.2 // 20% different popularity bands
}

export const EXPLORATION_PHASES: ExplorationPhase[] = [
  { level: 'high', ogDrift: 0.2, rounds: [1, 2] }, // Rounds 1-2: light exploration (similarity 80%)
  { level: 'medium', ogDrift: 0.5, rounds: [3, 5] }, // Rounds 3-5: balance (similarity 50%)
  { level: 'low', ogDrift: 0.8, rounds: [6, 10] } // Rounds 6-10: strong convergence (similarity 20%)
  // For rounds 11+, reuse 'low' with stronger drift via getExplorationPhase logic if needed
]

// --- Helper Functions ---

export function getExplorationPhase(roundNumber: number): ExplorationPhase {
  const phase = EXPLORATION_PHASES.find(
    (entry) => roundNumber >= entry.rounds[0] && roundNumber <= entry.rounds[1]
  )
  return phase ?? EXPLORATION_PHASES[EXPLORATION_PHASES.length - 1]
}

export type MoveCategory = 'closer' | 'neutral' | 'further'

/**
 * Determines the category of a move based on the attraction difference.
 * @param attraction - The attraction of the selected option to the target.
 * @param baseline - The attraction of the current song to the target.
 * @param tolerance - The tolerance for the neutral zone (default: 0.02).
 */
export function calculateMoveCategory(
  attraction: number,
  baseline: number,
  tolerance: number = 0.02
): MoveCategory {
  const diff = attraction - baseline
  if (diff > tolerance) return 'closer'
  if (diff < -tolerance) return 'further'
  return 'neutral'
}

/**
 * Helper to get card feedback for UI, checking server-assigned category first.
 */
export function getCardFeedback(
  option: DgsOptionTrack,
  activePlayerId: 'player1' | 'player2'
): MoveCategory {
  // Prefer server-assigned category if available
  if (option.metrics.selectionCategory) {
    return option.metrics.selectionCategory
  }

  // Fallback to strict calculation
  const currentPlayerAttraction =
    activePlayerId === 'player1'
      ? option.metrics.aAttraction
      : option.metrics.bAttraction

  const baseline = option.metrics.currentSongAttraction

  return calculateMoveCategory(currentPlayerAttraction, baseline)
}
