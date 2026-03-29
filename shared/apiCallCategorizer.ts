/**
 * API call categorization and statistics tracking interface
 * Extracted from services/game/apiStatisticsTracker.ts to break the
 * shared/ → services/game/ dependency.
 */

export type OperationType =
  | 'topTracks'
  | 'trackDetails'
  | 'relatedArtists'
  | 'artistProfiles'
  | 'artistSearches'

export interface ApiStatisticsTracker {
  recordApiCall(operationType: OperationType, durationMs?: number): void
  recordCacheHit(operationType: OperationType, cacheLevel: string): void
  recordFromSpotify(operationType: OperationType, itemCount: number): void
  recordRequest(operationType: OperationType): void
  recordDbQuery(operation: string, durationMs: number): void
}

/**
 * Automatically categorize API calls based on path patterns
 */
export function categorizeApiCall(path: string): OperationType | null {
  if (path.includes('/top-tracks')) {
    return 'topTracks'
  }
  if (path.includes('/artists?ids=')) {
    return 'artistProfiles' // Batch artist profiles
  }
  if (
    path.includes('/artists/') &&
    !path.includes('/related-artists') &&
    !path.includes('/top-tracks')
  ) {
    return 'artistProfiles' // Single artist profile
  }
  if (path.includes('/related-artists')) {
    return 'relatedArtists'
  }
  if (path.includes('/search?type=artist')) {
    return 'artistSearches'
  }
  if (path.includes('/tracks?ids=')) {
    return 'trackDetails' // Batch track details
  }
  if (path.includes('/tracks/') && path.match(/\/tracks\/[^/]+$/)) {
    return 'trackDetails' // Single track details
  }

  return null
}
