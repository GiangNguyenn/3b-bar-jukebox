import type { DgsDebugInfo, DgsCachingMetrics } from './dgsTypes'

/**
 * robustly merges two DgsDebugInfo objects.
 * Handles partial updates and accumulates caching metrics.
 */
export const mergeDebugInfo = (
  prev: DgsDebugInfo | undefined,
  next: DgsDebugInfo | undefined
): DgsDebugInfo | undefined => {
  if (!prev) return next
  if (!next) return prev

  const merged: DgsDebugInfo = { ...prev, ...next }

  // Merge Caching Stats
  if (prev.caching && next.caching) {
    const c1 = prev.caching
    const c2 = next.caching
    merged.caching = {
      topTracksRequested: c1.topTracksRequested + c2.topTracksRequested,
      topTracksCached: c1.topTracksCached + c2.topTracksCached,
      topTracksFromSpotify: c1.topTracksFromSpotify + c2.topTracksFromSpotify,
      topTracksApiCalls: c1.topTracksApiCalls + c2.topTracksApiCalls,

      trackDetailsRequested:
        c1.trackDetailsRequested + c2.trackDetailsRequested,
      trackDetailsCached: c1.trackDetailsCached + c2.trackDetailsCached,
      trackDetailsFromSpotify:
        c1.trackDetailsFromSpotify + c2.trackDetailsFromSpotify,
      trackDetailsApiCalls: c1.trackDetailsApiCalls + c2.trackDetailsApiCalls,

      relatedArtistsRequested:
        c1.relatedArtistsRequested + c2.relatedArtistsRequested,
      relatedArtistsCached: c1.relatedArtistsCached + c2.relatedArtistsCached,
      relatedArtistsFromSpotify:
        c1.relatedArtistsFromSpotify + c2.relatedArtistsFromSpotify,
      relatedArtistsApiCalls:
        c1.relatedArtistsApiCalls + c2.relatedArtistsApiCalls,

      artistProfilesRequested:
        c1.artistProfilesRequested + c2.artistProfilesRequested,
      artistProfilesCached: c1.artistProfilesCached + c2.artistProfilesCached,
      artistProfilesFromSpotify:
        c1.artistProfilesFromSpotify + c2.artistProfilesFromSpotify,
      artistProfilesApiCalls:
        c1.artistProfilesApiCalls + c2.artistProfilesApiCalls,

      artistSearchesRequested:
        c1.artistSearchesRequested + c2.artistSearchesRequested,
      artistSearchesCached: c1.artistSearchesCached + c2.artistSearchesCached,
      artistSearchesFromSpotify:
        c1.artistSearchesFromSpotify + c2.artistSearchesFromSpotify,
      artistSearchesApiCalls:
        c1.artistSearchesApiCalls + c2.artistSearchesApiCalls,

      // Recalculate totals
      cacheHitRate: 0,
      totalApiCalls: c1.totalApiCalls + c2.totalApiCalls,
      totalCacheHits: c1.totalCacheHits + c2.totalCacheHits
    }

    const totalReq =
      merged.caching.topTracksRequested +
      merged.caching.trackDetailsRequested +
      merged.caching.relatedArtistsRequested +
      merged.caching.artistProfilesRequested +
      merged.caching.artistSearchesRequested

    const calculatedRate = totalReq > 0 ? merged.caching.totalCacheHits / totalReq : 0
    merged.caching.cacheHitRate = Math.min(1.0, calculatedRate) // Cap at 100% to prevent impossible rates
  }

  // Merge Artist Profiles Stats (if structure exists)
  if (prev.artistProfiles && next.artistProfiles) {
    merged.artistProfiles = {
      requested: prev.artistProfiles.requested + next.artistProfiles.requested,
      fetched: prev.artistProfiles.fetched + next.artistProfiles.fetched,
      missing: prev.artistProfiles.missing + next.artistProfiles.missing,
      successRate: 0 // Recalc below
    }
    const total = merged.artistProfiles.requested
    merged.artistProfiles.successRate =
      total > 0 ? (merged.artistProfiles.fetched / total) * 100 : 0
  } else if (next.artistProfiles) {
    merged.artistProfiles = next.artistProfiles
  } else if (prev.artistProfiles) {
    merged.artistProfiles = prev.artistProfiles
  }

  // Scoring: usually Stage 3 has the final scoring, so we prefer next,
  // but if next doesn't have it (e.g. stage 2 response), keep prev.
  if (next.scoring) {
    merged.scoring = next.scoring
  } else {
    merged.scoring = prev.scoring
  }

  // Candidates: Merge arrays
  if (prev.candidates || next.candidates) {
    merged.candidates = [...(prev.candidates || []), ...(next.candidates || [])]
  }

  return merged
}
