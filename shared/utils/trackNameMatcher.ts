import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('TrackNameMatcher')

/**
 * Normalize a track name for fuzzy comparison by:
 * - Converting to lowercase
 * - Stripping parenthetical suffixes like "(feat. X)", "(Remastered 2011)", "(Deluxe Edition)", "(Live)"
 * - Stripping dash suffixes like "- Remastered", "- Deluxe Edition"
 * - Trimming whitespace
 */
export function normalizeTrackName(name: string): string {
  let normalized = name.toLowerCase()

  // Strip parenthetical suffixes: "(feat. X)", "(Remastered 2011)", "(Deluxe Edition)", "(Live)", etc.
  normalized = normalized.replace(/\s*\([^)]*\)\s*/g, ' ')

  // Strip dash suffixes: "- Remastered", "- Deluxe Edition", "- Live", etc.
  normalized = normalized.replace(
    /\s*-\s+(remaster(ed)?|deluxe|live|mono|stereo|remix|bonus|anniversary|expanded|special|original|radio|acoustic|instrumental|single|album|edit|version|mix)\b.*/i,
    ''
  )

  return normalized.trim()
}

/**
 * Fuzzy compare two track names after normalization.
 * Returns true if the base names match (same song, different metadata suffixes).
 */
export function fuzzyTrackNameMatch(
  queueName: string,
  spotifyName: string
): boolean {
  const normalizedQueue = normalizeTrackName(queueName)
  const normalizedSpotify = normalizeTrackName(spotifyName)

  const isMatch = normalizedQueue === normalizedSpotify

  if (!isMatch) {
    log(
      'LOG',
      `Fuzzy match failed: "${queueName}" -> "${normalizedQueue}" vs "${spotifyName}" -> "${normalizedSpotify}"`
    )
  }

  return isMatch
}
