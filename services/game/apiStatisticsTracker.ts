/**
 * Centralized API Statistics Tracker for DGS Engine
 * Provides single source of truth for all Spotify API and cache statistics
 */

export type OperationType =
  | 'topTracks'
  | 'trackDetails'
  | 'relatedArtists'
  | 'artistProfiles'
  | 'artistSearches'

export type CacheLevel = 'memory' | 'database'

export interface ApiStatistics {
  // Top Tracks
  topTracksRequested: number
  topTracksCached: number
  topTracksFromSpotify: number
  topTracksApiCalls: number

  // Track Details
  trackDetailsRequested: number
  trackDetailsCached: number
  trackDetailsFromSpotify: number
  trackDetailsApiCalls: number

  // Related Artists
  relatedArtistsRequested: number
  relatedArtistsCached: number
  relatedArtistsFromSpotify: number
  relatedArtistsApiCalls: number

  // Artist Profiles
  artistProfilesRequested: number
  artistProfilesCached: number
  artistProfilesFromSpotify: number
  artistProfilesApiCalls: number

  // Artist Searches
  artistSearchesRequested: number
  artistSearchesCached: number
  artistSearchesFromSpotify: number
  artistSearchesApiCalls: number

  // Overall metrics
  cacheHitRate: number
  totalApiCalls: number
  totalCacheHits: number
}

export class ApiStatisticsTracker {
  private stats = {
    // Top Tracks
    topTracksRequested: 0,
    topTracksCached: 0,
    topTracksFromSpotify: 0,
    topTracksApiCalls: 0,

    // Track Details
    trackDetailsRequested: 0,
    trackDetailsCached: 0,
    trackDetailsFromSpotify: 0,
    trackDetailsApiCalls: 0,

    // Related Artists
    relatedArtistsRequested: 0,
    relatedArtistsCached: 0,
    relatedArtistsFromSpotify: 0,
    relatedArtistsApiCalls: 0,

    // Artist Profiles
    artistProfilesRequested: 0,
    artistProfilesCached: 0,
    artistProfilesFromSpotify: 0,
    artistProfilesApiCalls: 0,

    // Artist Searches
    artistSearchesRequested: 0,
    artistSearchesCached: 0,
    artistSearchesFromSpotify: 0,
    artistSearchesApiCalls: 0
  }

  private apiCalls: Array<{ operation: string; durationMs: number }> = []
  private dbQueries: Array<{ operation: string; durationMs: number }> = []

  /**
   * Record that a request was made for a specific operation type
   */
  recordRequest(operationType: OperationType): void {
    this.stats[`${operationType}Requested`]++
  }

  /**
   * Record a cache hit for a specific operation type
   */
  recordCacheHit(operationType: OperationType, cacheLevel: CacheLevel): void {
    this.stats[`${operationType}Cached`]++
  }

  /**
   * Record items retrieved from Spotify API
   */
  recordFromSpotify(operationType: OperationType, itemCount: number): void {
    this.stats[`${operationType}FromSpotify`] += itemCount
  }

  /**
   * Record an API call for a specific operation type
   */
  recordApiCall(operationType: OperationType, durationMs: number = 0): void {
    this.stats[`${operationType}ApiCalls`]++
    if (durationMs > 0) {
      this.apiCalls.push({ operation: operationType, durationMs })
    }
  }

  /**
   * Record a DB query
   */
  recordDbQuery(operation: string, durationMs: number): void {
    this.dbQueries.push({ operation, durationMs })
  }

  /**
   * Get the current aggregated statistics
   */
  getStatistics(): ApiStatistics {
    const totalRequests =
      this.stats.topTracksRequested +
      this.stats.trackDetailsRequested +
      this.stats.relatedArtistsRequested +
      this.stats.artistProfilesRequested +
      this.stats.artistSearchesRequested

    const totalCached =
      this.stats.topTracksCached +
      this.stats.trackDetailsCached +
      this.stats.relatedArtistsCached +
      this.stats.artistProfilesCached +
      this.stats.artistSearchesCached

    const totalApiCalls =
      this.stats.topTracksApiCalls +
      this.stats.trackDetailsApiCalls +
      this.stats.relatedArtistsApiCalls +
      this.stats.artistProfilesApiCalls +
      this.stats.artistSearchesApiCalls

    const cacheHitRate = totalRequests > 0 ? totalCached / totalRequests : 0

    return {
      ...this.stats,
      cacheHitRate: Math.min(1.0, cacheHitRate), // Cap at 1.0 (100%)
      totalApiCalls,
      totalCacheHits: totalCached
    }
  }

  /**
   * Get performance diagnostics including detailed API calls and DB queries
   */
  getPerformanceDiagnostics() {
    return {
      apiCalls: this.apiCalls,
      dbQueries: this.dbQueries,
      totalApiTimeMs: this.apiCalls.reduce(
        (acc, call) => acc + call.durationMs,
        0
      ),
      totalDbTimeMs: this.dbQueries.reduce(
        (acc, query) => acc + query.durationMs,
        0
      ),
      slowestApiCall:
        this.apiCalls.length > 0
          ? this.apiCalls.reduce((prev, current) =>
              prev.durationMs > current.durationMs ? prev : current
            )
          : null,
      slowestDbQuery:
        this.dbQueries.length > 0
          ? this.dbQueries.reduce((prev, current) =>
              prev.durationMs > current.durationMs ? prev : current
            )
          : null
    }
  }

  /**
   * Reset all statistics (useful for new game rounds)
   */
  reset(): void {
    Object.keys(this.stats).forEach((key) => {
      this.stats[key as keyof typeof this.stats] = 0
    })
  }

  /**
   * Get a snapshot of current statistics for debugging
   */
  getDebugSnapshot(): Record<string, number> {
    return { ...this.stats }
  }

  /**
   * Validate that the statistics add up correctly
   */
  validateStatistics(): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    const operations: OperationType[] = [
      'topTracks',
      'trackDetails',
      'relatedArtists',
      'artistProfiles',
      'artistSearches'
    ]

    for (const op of operations) {
      const requested = this.stats[`${op}Requested`]
      const cached = this.stats[`${op}Cached`]
      const fromSpotify = this.stats[`${op}FromSpotify`]

      // Check if requested = cached + fromSpotify (within tolerance)
      const expectedFromApi = requested - cached
      if (Math.abs(fromSpotify - expectedFromApi) > 5) {
        // Allow 5 item tolerance
        errors.push(
          `${op}: Requested=${requested}, Cached=${cached}, FromAPI=${fromSpotify}, ExpectedFromAPI=${expectedFromApi}`
        )
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }
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
