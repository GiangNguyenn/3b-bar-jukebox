import { GENRE_MAPPINGS, COMPOUND_GENRE_MAPPINGS } from './genreConstants'
import { createModuleLogger } from '@/shared/utils/logger'
import type { GenreMatchDetail, GenreScoreComponent } from './dgsTypes'

const logger = createModuleLogger('GenreGraph')

// Base weight for exact match
const WEIGHT_EXACT = 1.0
// Weight for partial match (e.g. "alt rock" matches "rock")
const WEIGHT_PARTIAL = 0.9
// Weight for same cluster match
const WEIGHT_CLUSTER = 0.7

// Graph edges: [GenreA, GenreB, Weight]
// Bidirectional relationships between parent clusters
const CLUSTER_EDGES: [string, string, number][] = [
  ['Metal', 'Rock', 0.8],
  ['Punk', 'Rock', 0.8],
  ['Alternative', 'Rock', 0.7],
  ['Indie', 'Alternative', 0.8],
  ['Blues', 'Rock', 0.6],
  ['Hip-Hop', 'R&B', 0.7],
  ['Pop', 'R&B', 0.6],
  ['Pop', 'Electronic', 0.5],
  ['Electronic', 'Dance', 0.8],
  ['House', 'Electronic', 0.9],
  ['Techno', 'Electronic', 0.9],
  ['Trance', 'Electronic', 0.9],
  ['Dubstep', 'Electronic', 0.7],
  ['Indie', 'Folk', 0.6],
  ['Country', 'Folk', 0.7],
  ['Soul', 'R&B', 0.8],
  ['Funk', 'Soul', 0.8],
  ['Jazz', 'Blues', 0.5],
  ['Reggae', 'Hip-Hop', 0.4]
]

// Build adjacency list for O(1) lookups
const CLUSTER_RELATIONSHIPS = new Map<string, Map<string, number>>()

// Initialize relationships
CLUSTER_EDGES.forEach(([a, b, weight]) => {
  if (!CLUSTER_RELATIONSHIPS.has(a)) CLUSTER_RELATIONSHIPS.set(a, new Map())
  if (!CLUSTER_RELATIONSHIPS.has(b)) CLUSTER_RELATIONSHIPS.set(b, new Map())

  CLUSTER_RELATIONSHIPS.get(a)!.set(b, weight)
  CLUSTER_RELATIONSHIPS.get(b)!.set(a, weight)
})

/**
 * Get the parent cluster for a given genre string.
 * Uses heuristics and mappings to find the best parent category.
 */
export function getGenreCluster(genre: string): string | null {
  const normalized = genre.toLowerCase().trim()

  // 1. Direct mapping from constants
  if (GENRE_MAPPINGS[normalized]) return GENRE_MAPPINGS[normalized]

  // 2. Compound mapping (sub-genre -> parent)
  for (const [key, value] of Object.entries(COMPOUND_GENRE_MAPPINGS)) {
    if (normalized.includes(key)) return value
  }

  // 3. Reverse mapping check (is it one of our standard genres?)
  const standardGenres = Object.values(GENRE_MAPPINGS)
  const exactMatch = standardGenres.find((g) => g.toLowerCase() === normalized)
  if (exactMatch) return exactMatch

  // 4. String containment heuristic for standard genres
  // e.g. "nu metal" -> "Metal", "roots reggae" -> "Reggae"
  for (const standard of standardGenres) {
    if (normalized.includes(standard.toLowerCase())) {
      return standard
    }
  }

  return null
}

/**
 * Calculate similarity between two single genre strings
 */
/**
 * Calculate similarity between two single genre strings with details
 */
export function calculateGenreSimilarityDetailed(
  genreA: string,
  genreB: string
): {
  score: number
  detail: Omit<GenreMatchDetail, 'candidateGenre' | 'bestMatchGenre'>
} {
  if (!genreA || !genreB)
    return { score: 0, detail: { score: 0, matchType: 'unrelated' } }

  const normA = genreA.toLowerCase().trim()
  const normB = genreB.toLowerCase().trim()

  // 1. Exact Match
  if (normA === normB)
    return {
      score: WEIGHT_EXACT,
      detail: { score: WEIGHT_EXACT, matchType: 'exact' }
    }

  // 2. Partial String Match
  if (normA.includes(normB) || normB.includes(normA)) {
    return {
      score: WEIGHT_PARTIAL,
      detail: { score: WEIGHT_PARTIAL, matchType: 'partial' }
    }
  }

  // 3. Cluster Analysis
  const clusterA = getGenreCluster(normA)
  const clusterB = getGenreCluster(normB)

  if (!clusterA || !clusterB) {
    return {
      score: 0,
      detail: {
        score: 0,
        matchType: 'unrelated',
        clusterA: clusterA ?? undefined,
        clusterB: clusterB ?? undefined
      }
    }
  }

  // Same Cluster
  if (clusterA === clusterB) {
    return {
      score: WEIGHT_CLUSTER,
      detail: {
        score: WEIGHT_CLUSTER,
        matchType: 'cluster',
        clusterA,
        clusterB
      }
    }
  }

  // 4. Related Clusters
  const relations = CLUSTER_RELATIONSHIPS.get(clusterA)
  if (relations && relations.has(clusterB)) {
    const weight = relations.get(clusterB)!
    return {
      score: weight,
      detail: { score: weight, matchType: 'related', clusterA, clusterB }
    }
  }

  return {
    score: 0,
    detail: { score: 0, matchType: 'unrelated', clusterA, clusterB }
  }
}

/**
 * Wrapper for backward compatibility if needed, but we prefer the detailed version now used by dgsEngine
 */
export function calculateGenreSimilarity(
  genreA: string,
  genreB: string
): number {
  return calculateGenreSimilarityDetailed(genreA, genreB).score
}

/**
 * Calculate average maximum similarity between two sets of genres.
 * For each genre in candidate, find best match in base, then average those best matches.
 * This handles asymmetric cardinality better than Jaccard.
 */
export function calculateAvgMaxGenreSimilarity(
  baseGenres: string[],
  candidateGenres: string[]
): GenreScoreComponent {
  // Handle unknown genre special case
  const hasUnknownBase = baseGenres?.includes('unknown')
  const hasUnknownCandidate = candidateGenres?.includes('unknown')

  if (hasUnknownBase && hasUnknownCandidate) {
    // Both unknown - moderate similarity (0.5)
    return {
      score: 0.5,
      details: [
        {
          candidateGenre: 'unknown',
          bestMatchGenre: 'unknown',
          score: 0.5,
          matchType: 'cluster' // Treat unknowns as loosely clustered
        }
      ]
    }
  }

  if (hasUnknownBase || hasUnknownCandidate) {
    // One unknown - low similarity (0.2)
    return {
      score: 0.2,
      details: [
        {
          candidateGenre: hasUnknownCandidate
            ? 'unknown'
            : candidateGenres[0] || '',
          bestMatchGenre: hasUnknownBase ? 'unknown' : baseGenres[0] || '',
          score: 0.2,
          matchType: 'unrelated' // Treat mixed known/unknown as mostly unrelated
        }
      ]
    }
  }

  if (!baseGenres?.length || !candidateGenres?.length)
    return { score: 0, details: [] }

  let totalMaxScore = 0
  const details: GenreMatchDetail[] = []

  // For every candidate genre, find its best partner in the base genres
  for (const cGenre of candidateGenres) {
    let maxScoreForGenre = 0
    let bestDetail: GenreMatchDetail | null = null

    for (const bGenre of baseGenres) {
      const { score, detail } = calculateGenreSimilarityDetailed(bGenre, cGenre) // Note: bGenre is A (Base) context-wise? Wait function is symmetric mostly.
      // Using calculateGenreSimilarityDetailed(genreA, genreB)
      // Let's assume A=Base, B=Candidate for consistency inside the function logic if strictly directional,
      // but here similarity is symmetric.

      if (score > maxScoreForGenre) {
        maxScoreForGenre = score
        bestDetail = {
          ...detail,
          candidateGenre: cGenre,
          bestMatchGenre: bGenre
        }
      }
      if (maxScoreForGenre === 1.0) break
    }

    if (bestDetail) {
      details.push(bestDetail)
    } else {
      // Case where no match > 0 found, still record the attempt?
      // Or just record 0. For completeness let's record the best (which is 0)
      // But we don't have a "bestMatchGenre" if all are 0.
      // We'll skip pushing 0s to details to keep it clean, or push a simplified one.
      // pushing nothing means the user won't see why it failed.
      // Let's only push significant matches (>0) or the best available (even if 0) for debugging.
      // Actually, showing 0s clutters the UI. Let's show only matches > 0.
      // Wait, the user wants to see WHY valid scores happened.
    }

    totalMaxScore += maxScoreForGenre
  }

  const avgScore = totalMaxScore / candidateGenres.length

  // Sort details by score descending
  details.sort((a, b) => b.score - a.score)

  return {
    score: avgScore,
    details: details
  }
}
