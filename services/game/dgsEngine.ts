import { sendApiRequest } from '@/shared/api'
import { ApiStatisticsTracker } from './apiStatisticsTracker'
import type { ApiStatisticsTracker as ApiStatisticsTrackerType } from './apiStatisticsTracker'
import type {
  SpotifyArtist,
  SpotifyPlaybackState,
  TrackDetails
} from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'
import { cache } from '@/shared/utils/cache'
import { supabase } from '@/lib/supabase'
import { musicService, DataSource } from '../musicService'
import {
  batchGetArtistProfilesWithCache,
  getRelatedArtistsWithCache,
  getCachedRelatedArtists,
  upsertRelatedArtists,
  batchUpsertArtistProfiles,
  batchGetTopTracksFromDb,
  upsertTopTracks,
  upsertTrackDetails,
  upsertArtistProfile
} from './dgsCache'
import {
  CandidateTrackMetrics,
  CandidateSeed,
  CandidateSource,
  ArtistProfile,
  TargetProfile,
  CategoryQuality,
  CATEGORY_WEIGHTS,
  GUARANTEED_MINIMUMS,
  DIVERSITY_SOURCES,
  DgsOptionTrack,
  DEFAULT_PLAYER_GRAVITY,
  DISPLAY_OPTION_COUNT,
  DualGravityRequest,
  DualGravityResponse,
  PopularityBand,
  GRAVITY_LIMITS,
  MAX_ARTIST_REPETITIONS,
  MAX_CANDIDATE_POOL,
  MAX_ROUND_TURNS,
  MIN_CANDIDATE_POOL,
  MIN_UNIQUE_ARTISTS,
  MIN_QUALITY_THRESHOLDS,
  OG_CONSTANT,
  PlayerGravityMap,
  PlayerId,
  PlayerTargetsMap,
  VICINITY_DISTANCE_THRESHOLD,
  ScoringComponents,
  DgsCachingMetrics
} from './dgsTypes'
import type { TargetArtist } from '../gameService'
import {
  clampGravity,
  isValidSpotifyId,
  getPopularityBand,
  extractTrackMetadata,
  computeFollowerSimilarity,
  computePopularitySimilarity,
  computeAttraction,
  computeSimilarity,
  normalizeGravities,
  sourcePriority,
  calcStats
} from './dgsScoring'
import type { TrackMetadata } from './dgsScoring'
import { getRelatedArtistsForGame } from '../gameService'
import {
  getArtistTopTracksServer,
  getRelatedArtistsServer,
  searchTracksByGenreServer
} from '../spotifyApiServer'
import {
  fetchRandomTracksFromDb,
  fetchRandomArtistsFromDb,
  fetchTracksByArtistIdsFromDb,
  fetchTracksByGenreFromDb,
  fetchTracksCloserToTarget,
  fetchTracksFurtherFromTarget,
  getGenreStatistics
} from './dgsDb'
import { enqueueLazyUpdate } from './lazyUpdateQueue'
import { safeBackfillArtistGenres } from './genreBackfill'
import { safeBackfillTrackDetails } from './trackBackfill'
import { calculateAvgMaxGenreSimilarity } from './genreGraph'
import { getExplorationPhase } from './gameRules'
import { applyDiversityConstraints } from './dgsDiversity'

const logger = createModuleLogger('DgsEngine')

// Hard deadline (ms) to ensure engine completes well under serverless timeout
// Keep well under hobby/serverless limits
const HARD_DEADLINE_MS = 9000

function hasExceededDeadline(startTime: number): boolean {
  return Date.now() - startTime > HARD_DEADLINE_MS
}

// Shuffle array in place using Fisher-Yates algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array] // Create a copy to avoid mutating the original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// Performance instrumentation - track timing for database and API operations
interface TimedOperation {
  operation: string
  durationMs: number
}

const dbQueryTimings: TimedOperation[] = []
const apiCallTimings: TimedOperation[] = []

async function timeDbQuery<T>(
  operation: string,
  query: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  const result = await query()
  const durationMs = Date.now() - start
  dbQueryTimings.push({ operation, durationMs })
  logger('INFO', `[DB TIMING] ${operation}: ${durationMs}ms`)
  return result
}

async function timeApiCall<T>(
  operation: string,
  apiCall: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  const result = await apiCall()
  const durationMs = Date.now() - start
  apiCallTimings.push({ operation, durationMs })
  logger('INFO', `[API TIMING] ${operation}: ${durationMs}ms`)
  return result
}

export function resetPerformanceTimings() {
  dbQueryTimings.length = 0
  apiCallTimings.length = 0
}

// Diagnostic Logging Helper
import { PipelineLogEntry } from './dgsTypes'

// Global logs accumulator for the current request (module-level, be careful with concurrency if stateful)
// Better approach: Pass the logs array around or return it.
// For now, we'll modify the function signatures to accept/return logs, OR we can use the result object to return logs.
// Let's modify fetchTopTracksForArtists to return logs.

export function createPipelineLog(
  stage: PipelineLogEntry['stage'],
  level: PipelineLogEntry['level'],
  message: string,
  details?: any
): PipelineLogEntry {
  return {
    stage,
    level,
    message,
    details,
    timestamp: Date.now()
  }
}

interface GravityComputationContext {
  playerTargets: PlayerTargetsMap
  targetProfiles: Record<PlayerId, TargetProfile | null>
  artistProfiles: Map<string, ArtistProfile>
}

export async function runDualGravityEngine(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  request: DualGravityRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  token: string
): Promise<DualGravityResponse> {
  throw new Error(
    'DGS Engine: runDualGravityEngine is deprecated. Use the multi-stage pipeline instead.'
  )
}

export function ensureTargets(targets: PlayerTargetsMap): PlayerTargetsMap {
  return {
    player1: targets.player1 ?? null,
    player2: targets.player2 ?? null
  }
}

// DEPRECATED FUNCTIONS REMOVED:
// - addTargetArtistsToPool: Only used by old stage3-score route
// - ensureTargetDiversity: Only used by old stage3-score route
// - buildCandidatePool: Not exported, not called anywhere (~1077 lines)
// - addRelatedArtistTracks: Only called by buildCandidatePool
// - registerCandidate: Only called by buildCandidatePool and addRelatedArtistTracks
// - resetFilteringStats and countUniqueArtists: Only used by buildCandidatePool
// These were part of the old architecture that fetched tracks first, then scored them.
// The new architecture (stage1-artists -> stage2-score-artists -> stage3-fetch-tracks)
// scores artists first, then fetches tracks only for selected artists.

// DEPRECATED: buildCandidatePool function removed (was ~1077 lines)
// This function was not exported and not called anywhere.
// It was part of the old architecture that fetched tracks first, then scored them.
// The new architecture scores artists first, then fetches tracks only for selected artists.

// DEPRECATED: All buildCandidatePool function body removed (~1050 lines)
// The function body has been deleted as it was not exported and not called anywhere.

// DEPRECATED: addRelatedArtistTracks, registerCandidate, resetFilteringStats, countUniqueArtists removed
// These functions were only used by buildCandidatePool which has been removed.
// The new architecture uses fetchTopTracksForArtists directly in stage3-fetch-tracks.

/**

// DEPRECATED: buildCandidatePool function body removed (~1050 lines)
// The function body has been deleted as it was not exported and not called anywhere.

// DEPRECATED: addRelatedArtistTracks, registerCandidate, resetFilteringStats, countUniqueArtists removed
// These functions were only used by buildCandidatePool which has been removed.
// The new architecture uses fetchTopTracksForArtists directly in stage3-fetch-tracks.

/**
 * Look up Spotify artist ID by artist name
 * Database-first approach: checks DB, then optionally searches Spotify
 * Updates database with found artist info
 * @param isTargetArtist - If true, searches Spotify when not in DB. If false, returns null to minimize API calls.
 */
async function lookupArtistIdByName(
  artistName: string,
  token: string,
  statisticsTracker?: ApiStatisticsTracker,
  isTargetArtist: boolean = false
): Promise<string | null> {
  if (!artistName || artistName.trim() === '') {
    return null
  }

  const normalizedName = artistName.trim()

  // Track this search request
  statisticsTracker?.recordRequest('artistSearches')

  // First, check artists table in database
  try {
    const { data, error } = await supabase
      .from('artists')
      .select('spotify_artist_id')
      .ilike('name', normalizedName)
      .limit(1)
      .single()

    if (!error && data?.spotify_artist_id) {
      logger(
        'INFO',
        `Found artist in DB: ${normalizedName} -> ${data.spotify_artist_id}`,
        'lookupArtistIdByName'
      )
      statisticsTracker?.recordCacheHit('artistSearches', 'database')
      return data.spotify_artist_id
    }
  } catch (error) {
    // Not found in DB
  }

  // Database-first strategy: Only search Spotify for target artists
  // Non-target artists will be filtered out instead of making API calls
  if (!isTargetArtist) {
    logger(
      'INFO',
      `Artist not in DB, skipping Spotify search for non-target artist: ${normalizedName}`,
      'lookupArtistIdByName'
    )
    return null
  }

  // Target artist not in database - search Spotify
  try {
    logger(
      'INFO',
      `Target artist not in DB, searching Spotify: ${normalizedName}`,
      'lookupArtistIdByName'
    )

    statisticsTracker?.recordFromSpotify('artistSearches', 1)

    const searchResult = await sendApiRequest<{
      artists: {
        items: Array<{
          id: string
          name: string
          genres: string[]
          popularity?: number
          followers?: { total: number }
        }>
      }
    }>({
      path: `/search?q=${encodeURIComponent(normalizedName)}&type=artist&limit=1`,
      method: 'GET',
      token
    })

    const match = searchResult.artists?.items?.[0]
    if (match) {
      logger(
        'INFO',
        `Found on Spotify: ${normalizedName} -> ${match.id}`,
        'lookupArtistIdByName'
      )

      // Save to artists table asynchronously via queue
      void enqueueLazyUpdate({
        type: 'artist_profile',
        spotifyId: match.id,
        payload: {
          name: match.name,
          genres: match.genres ?? [],
          popularity: match.popularity,
          follower_count: match.followers?.total
        }
      })

      return match.id
    }
  } catch (error) {
    logger(
      'WARN',
      `Failed to search Spotify for artist: ${normalizedName}`,
      'lookupArtistIdByName',
      error instanceof Error ? error : undefined
    )
  }

  return null
}

export async function enrichCandidatesWithArtistProfiles(
  candidates: CandidateSeed[],
  existingProfiles: Map<string, ArtistProfile>,
  token: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<Map<string, ArtistProfile>> {
  // Extract all unique artist IDs and names from candidates
  const allArtistIds = new Set<string>()
  // Store reference to the artist object so we can update it in-place
  const artistsWithoutIds: Array<{
    artistObj: { id: string; name: string }
    trackId: string
  }> = []

  candidates.forEach((candidate) => {
    candidate.track.artists?.forEach((artist) => {
      if (artist?.id && isValidSpotifyId(artist.id)) {
        allArtistIds.add(artist.id)
      } else if (artist?.name && artist) {
        // Track has artist name but no valid ID (from database)
        artistsWithoutIds.push({
          artistObj: artist,
          trackId: candidate.track.id
        })
      }
    })
  })

  // Find missing artist IDs (not in existingProfiles map)
  const missingIds: string[] = []
  allArtistIds.forEach((id) => {
    if (!existingProfiles.has(id)) {
      missingIds.push(id)
    }
  })

  logger(
    'INFO',
    `Profile enrichment: ${allArtistIds.size} artists with IDs, ${artistsWithoutIds.length} artists without IDs | Missing profiles: ${missingIds.length}`,
    'enrichCandidatesWithArtistProfiles'
  )

  // Batch-fetch missing profiles from DB cache / Spotify
  const enrichedProfiles = new Map(existingProfiles)

  // Fetch by ID first
  if (missingIds.length > 0) {
    try {
      // Track requests for missing artist profiles
      for (const id of missingIds) {
        statisticsTracker?.recordRequest('artistProfiles')
      }

      // Pass cachingMetrics to track API calls accurately
      // The function modifies the metrics object directly
      const fetchedProfiles = await batchGetArtistProfilesWithCache(
        missingIds,
        token,
        statisticsTracker
      )

      fetchedProfiles.forEach((profile, id) => {
        enrichedProfiles.set(id, {
          id: profile.id,
          name: profile.name,
          genres: profile.genres,
          popularity: profile.popularity,
          followers: profile.followers
        })
      })

      logger(
        'INFO',
        `Profile enrichment (by ID): Fetched ${fetchedProfiles.size}/${missingIds.length} profiles`,
        'enrichCandidatesWithArtistProfiles'
      )
    } catch (error) {
      logger(
        'WARN',
        `Profile enrichment by ID failed`,
        'enrichCandidatesWithArtistProfiles',
        error instanceof Error ? error : undefined
      )
    }
  }

  // For artists without IDs, check database first, then search Spotify if needed
  if (artistsWithoutIds.length > 0) {
    logger(
      'INFO',
      `Enriching ${artistsWithoutIds.length} artists by name (database-first)...`,
      'enrichCandidatesWithArtistProfiles'
    )

    let nameSearchCount = 0
    const limitedSearches = artistsWithoutIds.slice(0, 20) // Limit to avoid too many API calls

    // First, try to resolve IDs from database (database-first strategy)
    const dbLookupPromises = limitedSearches.map(async (artistInfo) => {
      try {
        // Database-first: Check database directly before searching Spotify
        const normalizedName = artistInfo.artistObj.name.trim()
        const { data, error } = await supabase
          .from('artists')
          .select('spotify_artist_id')
          .ilike('name', normalizedName)
          .limit(1)
          .single()

        if (!error && data?.spotify_artist_id) {
          const dbArtistId = data.spotify_artist_id
          logger(
            'INFO',
            `Found artist in DB: ${normalizedName} -> ${dbArtistId}`,
            'enrichCandidatesWithArtistProfiles'
          )

          // Track database cache hit
          statisticsTracker?.recordRequest('artistSearches')
          statisticsTracker?.recordCacheHit('artistSearches', 'database')

          // Get full profile using the ID
          statisticsTracker?.recordRequest('artistProfiles')
          const profilesMap = await batchGetArtistProfilesWithCache(
            [dbArtistId],
            token,
            statisticsTracker
          )
          const fullProfile = profilesMap.get(dbArtistId)

          if (fullProfile) {
            enrichedProfiles.set(dbArtistId, {
              id: fullProfile.id,
              name: fullProfile.name,
              genres: fullProfile.genres ?? [],
              popularity: fullProfile.popularity,
              followers: fullProfile.followers
            })

            // Update the candidate's artist ID in-place
            if (artistInfo.artistObj) {
              logger(
                'INFO',
                `Resolved artist ID from DB for "${artistInfo.artistObj.name}": ${artistInfo.artistObj.id} -> ${dbArtistId}`,
                'enrichCandidatesWithArtistProfiles'
              )
              artistInfo.artistObj.id = dbArtistId
            }

            nameSearchCount++
            return { artistInfo, resolved: true }
          }
        }
        return { artistInfo, resolved: false }
      } catch (error) {
        // Not found in DB - this is expected for many artists
        return { artistInfo, resolved: false }
      }
    })

    const dbResults = await Promise.all(dbLookupPromises)
    const unresolvedArtists = dbResults
      .filter((result) => !result.resolved)
      .map((result) => result.artistInfo)

    // For artists not found in database, search Spotify as last resort
    for (const artistInfo of unresolvedArtists) {
      try {
        statisticsTracker?.recordRequest('artistSearches')
        statisticsTracker?.recordFromSpotify('artistSearches', 1)

        const searchResult = await sendApiRequest<{
          artists: {
            items: Array<{
              id: string
              name: string
              genres: string[]
              popularity?: number
              followers?: { total: number }
            }>
          }
        }>({
          path: `/search?q=${encodeURIComponent(artistInfo.artistObj.name)}&type=artist&limit=1`,
          method: 'GET',
          token
        })

        const match = searchResult.artists?.items?.[0]
        if (match) {
          enrichedProfiles.set(match.id, {
            id: match.id,
            name: match.name,
            genres: match.genres ?? [],
            popularity: match.popularity,
            followers: match.followers?.total
          })

          // CRITICAL FIX: Update the candidate's artist ID in-place
          // This ensures subsequent stages can find the profile using the Spotify ID
          if (artistInfo.artistObj) {
            logger(
              'INFO',
              `Resolved artist ID from Spotify for "${artistInfo.artistObj.name}": ${artistInfo.artistObj.id} -> ${match.id}`,
              'enrichCandidatesWithArtistProfiles'
            )
            artistInfo.artistObj.id = match.id
          }

          // Lazy Write-Back (REQ-DAT-01): Save the found profile to DB cache
          void upsertArtistProfile({
            spotify_artist_id: match.id,
            name: match.name,
            genres: match.genres ?? [],
            popularity: match.popularity,
            follower_count: match.followers?.total
          })

          nameSearchCount++
        }
      } catch (error) {
        // Continue on error - don't block the game
        logger(
          'WARN',
          `Failed to search for artist: ${artistInfo.artistObj.name}`,
          'enrichCandidatesWithArtistProfiles',
          error instanceof Error ? error : undefined
        )
      }
    }

    logger(
      'INFO',
      `Profile enrichment (by name): Fetched ${nameSearchCount}/${Math.min(artistsWithoutIds.length, 20)} profiles`,
      'enrichCandidatesWithArtistProfiles'
    )
  }

  logger(
    'INFO',
    `Profile enrichment complete: Total profiles now: ${enrichedProfiles.size}`,
    'enrichCandidatesWithArtistProfiles'
  )

  return enrichedProfiles
}

export async function resolveTargetProfiles(
  targets: PlayerTargetsMap,
  token: string,
  statisticsTracker: ApiStatisticsTracker
): Promise<Record<PlayerId, TargetProfile | null>> {
  logger(
    'INFO',
    `Resolving target profiles: P1=${targets.player1?.name ?? 'null'} (${targets.player1?.id ?? 'no-id'}) | P2=${targets.player2?.name ?? 'null'} (${targets.player2?.id ?? 'no-id'})`,
    'resolveTargetProfiles'
  )

  const entries = await Promise.all(
    (Object.entries(targets) as Array<[PlayerId, TargetArtist | null]>).map(
      async ([playerId, artist]) => {
        if (!artist?.name) {
          logger(
            'WARN',
            `Target artist missing for ${playerId}`,
            'resolveTargetProfiles'
          )
          return [playerId, null] as const
        }
        logger(
          'INFO',
          `Resolving target for ${playerId}: ${artist.name}${artist.id ? ` (ID: ${artist.id})` : ' (no ID, will search)'}`,
          'resolveTargetProfiles'
        )
        const profile = await lookupArtistProfile(
          artist,
          token,
          statisticsTracker
        )
        if (profile) {
          logger(
            'INFO',
            `Target resolved for ${playerId}: ${profile.artist.name} | SpotifyID=${profile.spotifyId ?? 'none'} | Genres=${profile.genres.length} [${profile.genres.slice(0, 3).join(', ')}${profile.genres.length > 3 ? '...' : ''}]`,
            'resolveTargetProfiles'
          )
        } else {
          logger(
            'WARN',
            `Failed to resolve target for ${playerId}: ${artist.name}`,
            'resolveTargetProfiles'
          )
        }
        return [playerId, profile] as const
      }
    )
  )

  const result = Object.fromEntries(entries) as Record<
    PlayerId,
    TargetProfile | null
  >
  const resolvedCount = Object.values(result).filter((p) => p !== null).length
  logger(
    'INFO',
    `Target resolution complete: ${resolvedCount}/2 targets resolved successfully`,
    'resolveTargetProfiles'
  )
  return result
}

async function lookupArtistProfile(
  artist: TargetArtist,
  token: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<TargetProfile | null> {
  try {
    // Validate Spotify ID format (base62, alphanumeric, typically 22 chars)
    // Database UUIDs have dashes and are invalid Spotify IDs
    let validSpotifyId = artist.id

    if (validSpotifyId && validSpotifyId.includes('-')) {
      logger(
        'WARN',
        `Invalid Spotify ID format (looks like database UUID): ${artist.name} (${validSpotifyId}). Falling back to search.`,
        'lookupArtistProfile'
      )
      validSpotifyId = undefined
    }

    if (validSpotifyId) {
      logger(
        'INFO',
        `Looking up target artist by ID: ${artist.name} (${validSpotifyId})`,
        'lookupArtistProfile'
      )
      // Use database-first approach for consistency
      statisticsTracker?.recordRequest('artistProfiles')
      const profilesMap = await batchGetArtistProfilesWithCache(
        [validSpotifyId],
        token,
        statisticsTracker
      )
      const fullProfile = profilesMap.get(validSpotifyId)

      if (fullProfile) {
        logger(
          'INFO',
          `Found by ID: ${fullProfile.name} | Genres=${fullProfile.genres?.length ?? 0} | Pop=${fullProfile.popularity ?? 'N/A'} | Followers=${fullProfile.followers ?? 'N/A'}`,
          'lookupArtistProfile'
        )

        // Check if genres are empty and trigger backfill if needed
        // Note: backfill should already be triggered in batchGetArtistProfilesWithCache,
        // but we double-check here for target artists to ensure it happens
        if (!fullProfile.genres || fullProfile.genres.length === 0) {
          // Check if already marked as unknown
          if (fullProfile.genres && fullProfile.genres.includes('unknown')) {
            logger(
              'INFO',
              `[Target Artist] "${fullProfile.name}" has unknown genre - skipping backfill`
            )
          } else {
            logger(
              'WARN',
              `[Target Artist] "${fullProfile.name}" (${fullProfile.id}) has no genres - ensuring backfill is triggered`
            )
            const { safeBackfillArtistGenres } = await import('./genreBackfill')
            void safeBackfillArtistGenres(
              fullProfile.id,
              fullProfile.name,
              token
            )
          }
        }

        return {
          artist,
          spotifyId: fullProfile.id,
          genres: fullProfile.genres ?? [],
          popularity: fullProfile.popularity,
          followers: fullProfile.followers
        }
      } else {
        logger(
          'WARN',
          `Target artist ID ${validSpotifyId} not found in cache/Spotify. Falling back to search by name.`,
          'lookupArtistProfile'
        )
        // Fallback to name search if ID lookup fails
      }
    }

    // Database-first strategy: Check database before searching Spotify
    logger(
      'INFO',
      `[TARGET SEARCH] Checking database first for: "${artist.name}"`,
      'lookupArtistProfile'
    )
    const dbArtistId = await lookupArtistIdByName(
      artist.name,
      token,
      statisticsTracker,
      true // isTargetArtist = true (always search Spotify for target artists if not in DB)
    )

    if (dbArtistId) {
      // Found in database, get full profile using the ID
      logger(
        'INFO',
        `[TARGET SEARCH] Found in database: "${artist.name}" -> ${dbArtistId}, fetching full profile`,
        'lookupArtistProfile'
      )
      statisticsTracker?.recordRequest('artistProfiles')
      const profilesMap = await batchGetArtistProfilesWithCache(
        [dbArtistId],
        token,
        statisticsTracker
      )
      const fullProfile = profilesMap.get(dbArtistId)

      if (fullProfile) {
        logger(
          'INFO',
          `Found by database lookup: ${fullProfile.name} | Genres=${fullProfile.genres?.length ?? 0} | Pop=${fullProfile.popularity ?? 'N/A'} | Followers=${fullProfile.followers ?? 'N/A'}`,
          'lookupArtistProfile'
        )

        // Check if genres are empty and trigger backfill if needed
        if (!fullProfile.genres || fullProfile.genres.length === 0) {
          if (fullProfile.genres && fullProfile.genres.includes('unknown')) {
            logger(
              'INFO',
              `[Target Artist] "${fullProfile.name}" has unknown genre - skipping backfill`
            )
          } else {
            const { safeBackfillArtistGenres } = await import('./genreBackfill')
            void safeBackfillArtistGenres(
              fullProfile.id,
              fullProfile.name,
              token
            )
          }
        }

        return {
          artist: { ...artist, id: dbArtistId },
          spotifyId: dbArtistId,
          genres: fullProfile.genres ?? [],
          popularity: fullProfile.popularity,
          followers: fullProfile.followers
        }
      }
    }

    // Not found in database, search Spotify
    const searchQuery = encodeURIComponent(artist.name)
    logger(
      'INFO',
      `[TARGET SEARCH] Not in database, searching Spotify for: "${artist.name}" | Encoded query: "${searchQuery}"`,
      'lookupArtistProfile'
    )
    statisticsTracker?.recordRequest('artistSearches')
    statisticsTracker?.recordFromSpotify('artistSearches', 1)

    // Search with more results to increase chance of finding correct artist
    const search = await sendApiRequest<{
      artists: {
        items: Array<{
          id: string
          name: string
          genres: string[]
          popularity?: number
          followers?: { total: number }
        }>
      }
    }>({
      path: `/search?q=${searchQuery}&type=artist&limit=5`,
      method: 'GET',
      token
    })

    // Log the raw response for debugging
    logger(
      'INFO',
      `[TARGET SEARCH] Spotify response for "${artist.name}": ${search.artists?.items?.length ?? 0} results`,
      'lookupArtistProfile'
    )

    if (search.artists?.items && search.artists.items.length > 0) {
      // Log all results for debugging
      search.artists.items.forEach((item, idx) => {
        logger(
          'INFO',
          `[TARGET SEARCH] Result ${idx + 1}: "${item.name}" (ID: ${item.id})`,
          'lookupArtistProfile'
        )
      })
    }

    // Try to find exact match first, or use first result
    let match = search.artists?.items?.find(
      (item) => item.name.toLowerCase() === artist.name.toLowerCase()
    )

    // If no exact match, use first result (most popular/relevant)
    if (!match && search.artists?.items && search.artists.items.length > 0) {
      match = search.artists.items[0]
      logger(
        'WARN',
        `[TARGET SEARCH] No exact match for "${artist.name}", using closest match: "${match.name}"`,
        'lookupArtistProfile'
      )
    }

    if (!match) {
      logger(
        'ERROR',
        `[TARGET SEARCH] No match found for target artist: "${artist.name}" | Search returned empty`,
        'lookupArtistProfile'
      )
      // Return null instead of partial profile - this indicates resolution failure
      return null
    }

    logger(
      'INFO',
      `Found by search: ${match.name} (${match.id}) | Genres=${match.genres?.length ?? 0} | Pop=${match.popularity ?? 'N/A'} | Followers=${match.followers?.total ?? 'N/A'}`,
      'lookupArtistProfile'
    )

    // Cache the found artist for future lookups asynchronously
    void enqueueLazyUpdate({
      type: 'artist_profile',
      spotifyId: match.id,
      payload: {
        name: match.name,
        genres: match.genres || [],
        popularity: match.popularity,
        follower_count: match.followers?.total
      }
    })

    // If Spotify returned no genres, trigger backfill (especially important for target artists)
    // If Spotify returned no genres, trigger backfill (especially important for target artists)
    if (!match.genres || match.genres.length === 0) {
      if (match.genres && match.genres.includes('unknown')) {
        logger(
          'INFO',
          `[Target Search] "${match.name}" has unknown genre - skipping backfill`
        )
      } else {
        const { safeBackfillArtistGenres } = await import('./genreBackfill')
        void safeBackfillArtistGenres(match.id, match.name, token)
      }
    }

    return {
      artist: { ...artist, id: match.id },
      spotifyId: match.id,
      genres: match.genres ?? [],
      popularity: match.popularity,
      followers: match.followers?.total
    }
  } catch (error) {
    logger(
      'ERROR',
      `[TARGET SEARCH] Exception while resolving target artist "${artist.name}": ${error instanceof Error ? error.message : String(error)}`,
      'lookupArtistProfile',
      error instanceof Error ? error : undefined
    )
    // Return null to indicate complete failure
    return null
  }
}

async function fetchArtistProfiles(
  candidates: CandidateSeed[],
  token: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<{
  profiles: Map<string, ArtistProfile>
  stats: {
    requested: number
    fetched: number
    missing: number
    successRate: number
    cacheHits: number
    dbHits: number
    apiCalls: number
  }
}> {
  const artistIds = new Set<string>()
  candidates.forEach((candidate) => {
    candidate.track.artists?.forEach((artist) => {
      if (artist?.id && isValidSpotifyId(artist.id)) {
        artistIds.add(artist.id)
      }
    })
  })

  const idList = Array.from(artistIds)
  const totalRequested = idList.length
  logger(
    'INFO',
    `Fetching artist profiles: ${totalRequested} unique artist IDs from ${candidates.length} candidates`,
    'fetchArtistProfiles'
  )

  const profileMap = new Map<string, ArtistProfile>()
  let cacheHits = 0
  let dbHits = 0
  let apiCalls = 0

  // Record requests for all artist IDs first
  if (statisticsTracker) {
    for (const id of idList) {
      statisticsTracker.recordRequest('artistProfiles')
    }
  }

  // Step 1: Check in-memory cache
  const uncachedIds: string[] = []
  for (const id of idList) {
    const cacheKey = `artist-profile:${id}`
    const cached = cache.get<ArtistProfile>(cacheKey)
    if (cached) {
      profileMap.set(id, cached)
      cacheHits++
      statisticsTracker?.recordCacheHit('artistProfiles', 'memory')
    } else {
      uncachedIds.push(id)
    }
  }

  if (cacheHits > 0) {
    logger('INFO', `Memory cache: ${cacheHits} hits`)
  }

  if (uncachedIds.length === 0) {
    return {
      profiles: profileMap,
      stats: {
        requested: totalRequested,
        fetched: totalRequested,
        missing: 0,
        successRate: 100,
        cacheHits,
        dbHits: 0,
        apiCalls: 0
      }
    }
  }

  const dbResults = await batchGetArtistProfilesWithCache(
    uncachedIds,
    token,
    statisticsTracker
  )

  // All results from batchGetArtistProfilesWithCache are either from DB cache or API
  // The function already updated cachingMetrics, so we use the results for our local stats
  dbHits = dbResults.size // All results from this call

  // API calls are tracked automatically by the statistics tracker

  for (const [id, profile] of Array.from(dbResults.entries())) {
    const artistProfile: ArtistProfile = {
      id: profile.id,
      name: profile.name,
      genres: profile.genres,
      popularity: profile.popularity,
      followers: profile.followers
    }
    profileMap.set(id, artistProfile)

    // Store in memory cache (5-minute TTL)
    const cacheKey = `artist-profile:${id}`
    cache.set(cacheKey, artistProfile, 5 * 60 * 1000)
  }

  const totalFetched = profileMap.size
  const totalMissing = totalRequested - totalFetched
  const successRate =
    totalRequested > 0 ? (totalFetched / totalRequested) * 100 : 0

  // Debug metrics validation
  if (statisticsTracker) {
    const stats = statisticsTracker.getStatistics()
    logger(
      'INFO',
      `Artist profiles metrics: Requested=${stats.artistProfilesRequested} | Cached=${stats.artistProfilesCached} | FromAPI=${stats.artistProfilesFromSpotify} | ApiCalls=${stats.artistProfilesApiCalls}`,
      'fetchArtistProfiles'
    )
  }

  logger(
    'INFO',
    `Artist profiles summary: Requested=${totalRequested} | Fetched=${totalFetched} | Missing=${totalMissing} | MemCache=${cacheHits} | DB=${dbHits} | API=${apiCalls} | SuccessRate=${successRate.toFixed(1)}%`,
    'fetchArtistProfiles'
  )

  if (totalMissing > 0) {
    logger(
      'WARN',
      `Missing ${totalMissing} artist profiles after all fetch attempts`,
      'fetchArtistProfiles'
    )
  }

  return {
    profiles: profileMap,
    stats: {
      requested: totalRequested,
      fetched: totalFetched,
      missing: totalMissing,
      successRate,
      cacheHits,
      dbHits,
      apiCalls
    }
  }
}

function artistProfileToSyntheticTrack(artistProfile: ArtistProfile): {
  track: TrackDetails
  metadata: TrackMetadata
} {
  return {
    track: {
      id: artistProfile.id,
      uri: `spotify:artist:${artistProfile.id}`,
      name: artistProfile.name,
      artists: [{ id: artistProfile.id, name: artistProfile.name }],
      popularity: artistProfile.popularity ?? 50,
      duration_ms: 180000,
      album: {
        name: '',
        images: [],
        release_date: ''
      },
      preview_url: null,
      is_playable: true,
      explicit: false
    },
    metadata: {
      popularity: artistProfile.popularity ?? 50,
      duration_ms: 180000,
      release_date: undefined,
      genres: artistProfile.genres,
      artistId: artistProfile.id
    }
  }
}

export async function scoreCandidates({
  candidates,
  playerGravities,
  targetProfiles,
  artistProfiles,
  artistRelationships,
  currentTrack,
  currentTrackMetadata,
  ogDrift,
  hardConvergenceActive,
  roundNumber,
  currentPlayerId,
  token,
  statisticsTracker,
  allowFallback = true
}: {
  candidates: CandidateSeed[]
  playerGravities: PlayerGravityMap
  targetProfiles: Record<PlayerId, TargetProfile | null>
  artistProfiles: Map<string, ArtistProfile>
  artistRelationships: Map<string, Set<string>>
  currentTrack: TrackDetails
  currentTrackMetadata: TrackMetadata
  ogDrift: number
  hardConvergenceActive: boolean
  roundNumber: number
  currentPlayerId: PlayerId
  token: string
  statisticsTracker?: ApiStatisticsTracker
  allowFallback?: boolean
}): Promise<{
  metrics: CandidateTrackMetrics[]
  debugInfo: {
    fallbackFetches: number
    p1NonZeroAttraction: number
    p2NonZeroAttraction: number
    zeroAttractionReasons: {
      missingArtistProfile: number
      nullTargetProfile: number
      zeroSimilarity: number
    }
    candidates: Array<{
      artistName: string
      trackName?: string
      source?: string
      simScore: number
      isTargetArtist: boolean
      skippedDueToMissingMetadata?: boolean
    }>
    totalCandidates: number // Added missing field definition
  }
}> {
  const metrics: CandidateTrackMetrics[] = []
  let fallbackFetchCount = 0
  const zeroAttractionReasons = {
    missingArtistProfile: 0,
    nullTargetProfile: 0,
    zeroSimilarity: 0
  }
  const attractionStats = {
    p1NonZero: 0,
    p2NonZero: 0,
    p1Scores: [] as number[],
    p2Scores: [] as number[],
    gravityScores: [] as number[],
    finalScores: [] as number[]
  }
  const candidateDebugInfo: Array<{
    artistName: string
    trackName?: string
    source?: string
    simScore: number
    isTargetArtist: boolean
    skippedDueToMissingMetadata?: boolean
  }> = []

  // Calculate baseline attraction: current song's artist to active player's target
  const currentSongArtistId = currentTrack.artists?.[0]?.id
  const currentSongArtistProfile = currentSongArtistId
    ? artistProfiles.get(currentSongArtistId)
    : undefined
  const currentPlayerTargetProfile = targetProfiles[currentPlayerId]

  const currentSongAttraction = computeAttraction(
    currentSongArtistProfile,
    currentPlayerTargetProfile,
    artistProfiles,
    artistRelationships
  ).score

  logger(
    'INFO',
    `Baseline attraction (current song to ${currentPlayerId} target): ${(currentSongAttraction ?? 0).toFixed(3)}`,
    'scoreCandidates'
  )

  // [STRICT COMPLIANCE] Fallback Injection to ensure minimum candidate pool size
  // REQ-FUN-01: "The system must ensure the final pre-selection pool contains at least 50 unique tracks before diversity filtering."
  const uniqueArtistNames = new Set<string>()
  candidates.forEach((c) => {
    if (c.track.artists?.[0]?.name) {
      uniqueArtistNames.add(normalizeName(c.track.artists[0].name))
    }
  })

  // Buffer of 20 unique artists to safely select 9 without duplicates
  const MIN_STRICT_UNIQUE_ARTISTS = 20
  const needsArtistFallback = uniqueArtistNames.size < MIN_STRICT_UNIQUE_ARTISTS

  // REQ-FUN-01: Ensure at least 50 unique tracks before diversity filtering
  const needsTrackFallback = candidates.length < MIN_CANDIDATE_POOL

  if ((needsArtistFallback || needsTrackFallback) && allowFallback) {
    if (needsTrackFallback) {
      logger(
        'WARN',
        `Candidate pool deficit (${candidates.length} < ${MIN_CANDIDATE_POOL}). Fetching fallback tracks for strict compliance (REQ-FUN-01).`,
        'scoreCandidates'
      )
    } else {
      logger(
        'WARN',
        `Unique artist deficit (${uniqueArtistNames.size} < ${MIN_STRICT_UNIQUE_ARTISTS}). Fetching fallback tracks for strict compliance.`,
        'scoreCandidates'
      )
    }

    // Calculate how many tracks we need
    const neededTracks = needsTrackFallback
      ? Math.max(
          MIN_CANDIDATE_POOL - candidates.length,
          MIN_STRICT_UNIQUE_ARTISTS - uniqueArtistNames.size
        )
      : MIN_STRICT_UNIQUE_ARTISTS - uniqueArtistNames.size

    const existingTrackIds = new Set(candidates.map((c) => c.track.id))

    // Blocking call to ensure we have data before scoring
    const fallbackResult = await fetchRandomTracksFromDb({
      neededArtists: Math.max(
        neededTracks,
        MIN_STRICT_UNIQUE_ARTISTS - uniqueArtistNames.size
      ),
      existingArtistNames: uniqueArtistNames, // Pass names to ignore artists we already have
      excludeSpotifyTrackIds: existingTrackIds,
      tracksPerArtist: needsTrackFallback
        ? Math.ceil(
            neededTracks /
              Math.max(1, MIN_STRICT_UNIQUE_ARTISTS - uniqueArtistNames.size)
          )
        : 1
    })

    if (fallbackResult.tracks.length > 0) {
      logger(
        'INFO',
        `Fallback fetched ${fallbackResult.tracks.length} tracks from ${fallbackResult.uniqueArtistsAdded} unique artists. New pool size: ${candidates.length + fallbackResult.tracks.length}`,
        'scoreCandidates'
      )
      fallbackResult.tracks.forEach((track) => {
        // Use track's artist ID as seedArtistId for database fallback tracks
        const seedArtistId = track.artists?.[0]?.id ?? ''
        candidates.push({
          track: track,
          source: 'recommendations', // Generic source
          seedArtistId
        })
      })
    } else {
      logger(
        'WARN',
        'Fallback failed to return any tracks. Proceeding with available candidates.',
        'scoreCandidates'
      )
    }
  }

  // Final validation: Log warning if still below minimum after fallback
  if (candidates.length < MIN_CANDIDATE_POOL) {
    logger(
      'WARN',
      `Candidate pool (${candidates.length}) still below minimum (${MIN_CANDIDATE_POOL}) after fallback. This may affect diversity filtering quality.`,
      'scoreCandidates'
    )
  }

  for (const candidate of candidates) {
    let artistId = candidate.track.artists?.[0]?.id
    const artistName = candidate.track.artists?.[0]?.name ?? 'Unknown'

    // If artist ID is missing or invalid (database tracks), look it up
    if ((!artistId || !isValidSpotifyId(artistId)) && allowFallback) {
      logger(
        'INFO',
        `Artist ID missing/invalid for ${artistName}, looking up Spotify ID`,
        'scoreCandidates'
      )
      const lookedUpArtistId = await lookupArtistIdByName(
        artistName,
        token,
        statisticsTracker
      )

      // Update the track object with the found ID
      if (lookedUpArtistId && candidate.track.artists?.[0]) {
        candidate.track.artists[0].id = lookedUpArtistId
        artistId = lookedUpArtistId
      }
    }

    let artistProfile = artistId ? artistProfiles.get(artistId) : undefined

    // Fallback: fetch missing artist profiles on-demand
    if (!artistProfile && artistId && allowFallback) {
      logger(
        'INFO',
        `Artist profile missing for ${artistName} (${artistId}), fetching on-demand`,
        'scoreCandidates'
      )
      statisticsTracker?.recordRequest('artistProfiles')
      artistProfile = await fetchArtistProfile(
        artistId,
        token,
        statisticsTracker
      )
      if (artistProfile) {
        artistProfiles.set(artistId, artistProfile)
        fallbackFetchCount++
        logger(
          'INFO',
          `Successfully fetched profile for ${artistName}: genres=${artistProfile.genres.length}`,
          'scoreCandidates'
        )
      } else {
        logger(
          'WARN',
          `Failed to fetch profile for ${artistName} (${artistId})`,
          'scoreCandidates'
        )
      }
    }

    const candidateMetadata = extractTrackMetadata(
      candidate.track,
      artistProfile
    )

    // LAZY BACKFILL: Check for missing metadata
    if (candidate.track.id && candidate.track.artists?.[0]?.name) {
      // 1. Missing Release Date (Era)
      if (
        !candidateMetadata.release_date ||
        candidateMetadata.release_date === '1970-01-01'
      ) {
        logger(
          'INFO',
          `[Lazy Backfill] Missing release date for "${candidate.track.name}" by "${candidate.track.artists[0].name}" - triggering backfill`,
          'scoreCandidates'
        )
        void safeBackfillTrackDetails(
          candidate.track.id,
          candidate.track.artists[0].name,
          candidate.track.name,
          token
        )
      }

      // 2. Missing Artist Metadata (Pop/Followers/Genres)
      // We check artistProfile because that's what we use for scoring
      if (
        artistProfile &&
        (artistProfile.followers === undefined ||
          artistProfile.popularity === undefined ||
          artistProfile.genres.length === 0)
      ) {
        logger(
          'INFO',
          `[Lazy Backfill] Missing artist metadata for "${artistProfile.name}" (pop: ${artistProfile.popularity}, followers: ${artistProfile.followers}, genres: ${artistProfile.genres.length}) - triggering backfill`,
          'scoreCandidates'
        )
        void safeBackfillArtistGenres(
          artistProfile.id,
          artistProfile.name,
          token
        )
      }
    }

    let { score: simScore, components: scoreComponents } = computeSimilarity(
      currentTrack,
      currentTrackMetadata,
      candidate.track,
      candidateMetadata,
      artistProfiles,
      artistRelationships
    )

    // Check if this candidate is a target artist
    const finalArtistName =
      artistProfile?.name ?? candidate.track.artists?.[0]?.name ?? 'Unknown'
    const normalizedCandidateName = normalizeName(finalArtistName)
    const isTargetArtist = Object.values(targetProfiles).some((target) => {
      if (!target) return false

      // [STRICT] Check ID match first if both IDs are available
      if (
        target.spotifyId &&
        artistId &&
        isValidSpotifyId(target.spotifyId) &&
        isValidSpotifyId(artistId)
      ) {
        return target.spotifyId === artistId
      }

      // Fallback to name match (legacy/fallback behavior)
      return normalizeName(target.artist.name) === normalizedCandidateName
    })

    // Collect candidate debug info
    candidateDebugInfo.push({
      artistName: finalArtistName,
      trackName: candidate.track.name,
      source: candidate.source,
      simScore,
      isTargetArtist
    })

    // Track why attraction might be zero
    if (!artistProfile) {
      zeroAttractionReasons.missingArtistProfile++
    }
    if (!targetProfiles.player1 || !targetProfiles.player2) {
      zeroAttractionReasons.nullTargetProfile++
    }

    const aAttractionResult = computeAttraction(
      artistProfile,
      targetProfiles.player1,
      artistProfiles,
      artistRelationships
    )
    const bAttractionResult = computeAttraction(
      artistProfile,
      targetProfiles.player2,
      artistProfiles,
      artistRelationships
    )

    const aAttractionVal = aAttractionResult.score
    const bAttraction = bAttractionResult.score

    // Override scoreComponents with the components from the ACTIVE player's attraction calculation
    // This effectively changes the Debug Panel to show "Target Genres" (active player) instead of "Current Song Genres"
    // Also updates the breakdown to reflect "Attraction" (Closer/Further logic) rather than "Similarity" (Stabilizer logic)
    if (currentPlayerId === 'player1') {
      scoreComponents = aAttractionResult.components
    } else {
      scoreComponents = bAttractionResult.components
    }

    // Track zero similarity (when profiles exist but similarity is 0)
    if (artistProfile && targetProfiles.player1 && aAttractionVal === 0) {
      zeroAttractionReasons.zeroSimilarity++
    }
    if (artistProfile && targetProfiles.player2 && bAttraction === 0) {
      zeroAttractionReasons.zeroSimilarity++
    }

    // Calculate gravity score based on current player's target
    // This biases the recommendations toward the active player's target artist
    const currentPlayerAttraction =
      currentPlayerId === 'player1' ? aAttractionVal : bAttraction
    const currentPlayerGravity = playerGravities[currentPlayerId]
    let gravityScore = currentPlayerGravity * currentPlayerAttraction

    // Boost target artist scores when gravity is high enough
    // This makes target artists more likely to appear when players have built up gravity
    const GRAVITY_BOOST_THRESHOLD = 0.35
    if (isTargetArtist && currentPlayerGravity >= GRAVITY_BOOST_THRESHOLD) {
      const targetBoost = 1.0 + currentPlayerGravity * 2.0
      gravityScore = gravityScore * targetBoost
      logger(
        'INFO',
        `Target artist boost applied: ${finalArtistName} | Gravity=${currentPlayerGravity.toFixed(3)} | Boost=${targetBoost.toFixed(2)}x | GravityScore=${gravityScore.toFixed(3)}`,
        'scoreCandidates'
      )
    }

    const stabilizedScore = simScore * (1 - ogDrift) + OG_CONSTANT

    // Calculate final score with aggressive gravity scaling
    // Goal: Enable scoring by round 5 (average) and definitely by round 10
    // Gravity score favors the current player's target

    // Aggressive gravity multiplier that increases rapidly
    // Round 1: 1.2x
    // Round 3: 2.6x
    // Round 5: 4.0x (strong influence - should enable scoring)
    // Round 10: 7.5x (very strong - targets dominate)
    // Round 15+: 11.0x+ (extremely strong)
    const gravityMultiplier = 0.5 + roundNumber * 0.7
    const gravityAdjustment = gravityScore * gravityMultiplier
    let finalScore = stabilizedScore + gravityAdjustment

    // Floor constraint: becomes very permissive quickly
    // Round 1-2: don't drop below 40% of similarity
    // Round 3-5: can drop to 15% of similarity
    // Round 6+: can drop to 5% of similarity (allow low-sim high-gravity options)
    let minScoreRatio: number
    if (roundNumber <= 2) {
      minScoreRatio = 0.4
    } else if (roundNumber <= 5) {
      minScoreRatio = 0.15
    } else {
      minScoreRatio = 0.05
    }
    const minScore = simScore * minScoreRatio
    finalScore = Math.max(minScore, finalScore)

    // Clamp final score to valid range [0, 1]
    finalScore = Math.max(0, Math.min(1, finalScore))
    const popularityBand = getPopularityBand(candidate.track.popularity ?? 50)
    // Simplified vicinity check using stub
    // The stub currently returns { p1: 1, p2: 1 } which doesn't match PlayerGravityMap exactly
    // We'll map it manually to satisfy the type checker for now
    // NOTE: This area was relying on runDualGravityEngine logic which we deprecated.
    // For now, we assume no vicinity boost to keep it safe.

    // Stub logic replacement (inline to fix type errors):
    // const vicinityDistances = computeVicinityDistances(...)
    // ^ This function signature in stub is causing issues.

    const vicinityDistances: Partial<Record<PlayerId, number>> = {
      player1: 1,
      player2: 1
    }

    // Vicinity boost (simplified)
    const vicinityBoost = 1.0

    // Track statistics
    if (aAttractionVal > 0) {
      attractionStats.p1NonZero++
      attractionStats.p1Scores.push(aAttractionVal)
    }
    if (bAttraction > 0) {
      attractionStats.p2NonZero++
      attractionStats.p2Scores.push(bAttraction)
    }
    attractionStats.gravityScores.push(gravityScore)
    attractionStats.finalScores.push(finalScore)

    // Detailed logging for each candidate
    logger(
      'INFO',
      `Candidate: ${artistName} (${artistId ?? 'no-id'}) | Profile: ${artistProfile ? 'found' : 'missing'} | Sim: ${simScore.toFixed(3)} | A-Attract: ${aAttractionVal.toFixed(3)} | B-Attract: ${bAttraction.toFixed(3)} | Gravity: ${gravityScore.toFixed(3)} | Final: ${finalScore.toFixed(3)} | P1-Dist: ${vicinityDistances.player1?.toFixed(3) ?? 'N/A'} | P2-Dist: ${vicinityDistances.player2?.toFixed(3) ?? 'N/A'}`,
      'scoreCandidates'
    )

    // Skip tracks with missing or empty critical metadata
    const trackName = candidate.track.name?.trim()
    const trackId = candidate.track.id?.trim()

    if (!trackName || !trackId) {
      logger(
        'WARN',
        `Skipping candidate with missing/empty track metadata: name="${candidate.track.name ?? 'missing'}", id="${candidate.track.id ?? 'missing'}"`,
        'scoreCandidates'
      )
      // Mark this candidate as skipped in debug info (it was already added above)
      const lastCandidate = candidateDebugInfo[candidateDebugInfo.length - 1]
      if (lastCandidate && lastCandidate.artistName === finalArtistName) {
        lastCandidate.skippedDueToMissingMetadata = true
      }
      continue
    }

    metrics.push({
      track: candidate.track,
      source: candidate.source,
      artistId,
      artistName: artistProfile?.name ?? candidate.track.artists?.[0]?.name,
      artistGenres: artistProfile?.genres ?? [],
      simScore,
      scoreComponents, // [NEW] Store the breakdown
      aAttraction: aAttractionVal,
      bAttraction,
      gravityScore,
      stabilizedScore,
      finalScore,
      popularityBand,
      vicinityDistances,
      currentSongAttraction
    })
  }

  const p1Stats = calcStats(attractionStats.p1Scores)
  const p2Stats = calcStats(attractionStats.p2Scores)
  const gravityStats = calcStats(attractionStats.gravityScores)
  const finalStats = calcStats(attractionStats.finalScores)

  logger(
    'INFO',
    `Scoring Summary: Total=${metrics.length} | FallbackFetches=${fallbackFetchCount} | P1-NonZero=${attractionStats.p1NonZero} | P2-NonZero=${attractionStats.p2NonZero} | P1-Attract: min=${p1Stats.min.toFixed(3)} max=${p1Stats.max.toFixed(3)} avg=${p1Stats.avg.toFixed(3)} | P2-Attract: min=${p2Stats.min.toFixed(3)} max=${p2Stats.max.toFixed(3)} avg=${p2Stats.avg.toFixed(3)} | Gravity: min=${gravityStats.min.toFixed(3)} max=${gravityStats.max.toFixed(3)} avg=${gravityStats.avg.toFixed(3)} | Final: min=${finalStats.min.toFixed(3)} max=${finalStats.max.toFixed(3)} avg=${finalStats.avg.toFixed(3)}`,
    'scoreCandidates'
  )

  return {
    metrics: metrics.sort((a, b) => b.finalScore - a.finalScore),
    debugInfo: {
      fallbackFetches: fallbackFetchCount,
      totalCandidates: candidateDebugInfo.length, // Total candidates scored (including skipped)
      p1NonZeroAttraction: attractionStats.p1NonZero,
      p2NonZeroAttraction: attractionStats.p2NonZero,
      zeroAttractionReasons,
      candidates: candidateDebugInfo // All candidates that were scored (full pool)
    }
  }
}

function computeArtistRelationshipScore(
  baseArtistId: string | undefined,
  candidateArtistId: string | undefined,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): number {
  // If same artist, return 1.0
  if (baseArtistId && candidateArtistId && baseArtistId === candidateArtistId) {
    return 1.0
  }

  // If either artist is missing, return 0.5 (neutral)
  if (!baseArtistId || !candidateArtistId) {
    return 0.5
  }

  // O(1) lookup in pre-fetched relationships map
  const baseRelations = artistRelationships.get(baseArtistId)
  if (baseRelations?.has(candidateArtistId)) {
    logger(
      'INFO',
      `Artist relationship found: ${baseArtistId} → ${candidateArtistId}`,
      'computeArtistRelationshipScore'
    )
    return 1.0
  }

  // Fallback: Check genre overlap as proxy for relationship
  const baseProfile = artistProfiles.get(baseArtistId)
  const candidateProfile = artistProfiles.get(candidateArtistId)

  if (!baseProfile || !candidateProfile) {
    return 0.5
  }

  // High genre overlap suggests related artists
  // Use weighted genre graph
  const genreOverlap = calculateAvgMaxGenreSimilarity(
    baseProfile.genres,
    candidateProfile.genres
  )
  return genreOverlap.score * 0.7 + 0.3 // Scale to 0.3-1.0 range
}

/**
 * Compute similarity strictly between two artists
 * Ignores track-level metadata like release date or track popularity
 * Used for "Attraction" calculation (Target-to-Candidate proximity)
 */

/**
 * Calculate similarity based on popularity scores (0-100)
 * Returns 0.0 to 1.0, where 1.0 = identical popularity
 */

/**
 * Calculate similarity based on follower counts using logarithmic scale
 * Returns 0.0 to 1.0, where 1.0 = similar fanbase size
 */

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export { applyDiversityConstraints }

function toOptionTrack(metric: CandidateTrackMetrics): DgsOptionTrack {
  const [primaryArtist] = metric.track.artists ?? []

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { track: _track, ...metrics } = metric

  return {
    track: metric.track,
    artist: primaryArtist ?? {
      id: metric.artistId ?? metric.track.id,
      name: metric.artistName ?? metric.track.name
    },
    metrics
  }
}

export function applyGravityUpdates({
  request
}: {
  request: DualGravityRequest
}): PlayerGravityMap {
  const gravities = { ...request.playerGravities }
  const lastSelection = request.lastSelection

  if (!lastSelection?.trackId) {
    return normalizeGravities(gravities)
  }

  // Adjust gravity based on selection quality relative to target
  // Closer choices accelerate convergence, further choices penalize
  const GRAVITY_ADJUSTMENTS = {
    closer: 0.1, // Good choice - moving toward target
    neutral: 0.02, // Maintaining position
    further: -0.05 // Bad choice - moving away from target
  }

  const selectionCategory = lastSelection.selectionCategory ?? 'neutral'
  const adjustment = GRAVITY_ADJUSTMENTS[selectionCategory]

  gravities[lastSelection.playerId] = clampGravity(
    gravities[lastSelection.playerId] + adjustment
  )

  logger(
    'INFO',
    `Gravity adjustment for ${selectionCategory} choice: Player ${lastSelection.playerId} ${adjustment >= 0 ? '+' : ''}${(adjustment ?? 0).toFixed(3)} | New gravity: ${(gravities[lastSelection.playerId] ?? 0).toFixed(3)}`,
    'applyGravityUpdates'
  )

  // Apply underdog boost if needed
  const opponentId =
    lastSelection.playerId === 'player1' ? 'player2' : 'player1'
  const opponentGravity = gravities[opponentId]
  if (gravities[lastSelection.playerId] > 0.5 && opponentGravity < 0.25) {
    gravities[opponentId] = clampGravity(opponentGravity + 0.05)
    logger(
      'INFO',
      `Underdog boost: Player ${opponentId} +0.05 | New gravity: ${(gravities[opponentId] ?? 0).toFixed(3)}`,
      'applyGravityUpdates'
    )
  }

  return normalizeGravities(gravities)
}

async function fetchArtistProfile(
  artistId: string,
  token: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<ArtistProfile | undefined> {
  if (!isValidSpotifyId(artistId)) {
    return undefined
  }

  statisticsTracker?.recordRequest('artistProfiles')

  // Use Unified Music Service
  const { data: profile, source } = await musicService.getArtist(
    artistId,
    token
  )

  if (profile) {
    // Update metrics
    if (statisticsTracker) {
      if (source === DataSource.MemoryCache) {
        statisticsTracker.recordCacheHit('artistProfiles', 'memory')
      } else if (source === DataSource.Database) {
        statisticsTracker.recordCacheHit('artistProfiles', 'database')
      } else if (source === DataSource.SpotifyAPI) {
        statisticsTracker.recordFromSpotify('artistProfiles', 1)
      }
    }

    return {
      id: profile.id,
      name: profile.name,
      genres: profile.genres ?? [],
      popularity: profile.popularity,
      followers: profile.followers
    }
  }

  logger(
    'WARN',
    `Failed to fetch artist profile ${artistId}`,
    'fetchArtistProfile'
  )
  return undefined
}

export async function getSeedRelatedArtistIds(
  seedArtistId: string,
  token: string
): Promise<string[]> {
  const { data: related } = await musicService.getRelatedArtists(
    seedArtistId,
    token
  )
  return related.map((a) => a.id)
}

export async function fetchTopTracksForArtists(
  artistIds: string[],
  token: string,
  statisticsTracker?: ApiStatisticsTracker,
  excludeTrackIds?: Set<string>
): Promise<{
  seeds: CandidateSeed[]
  failedArtists: string[]
  logs: PipelineLogEntry[]
}> {
  const seeds: CandidateSeed[] = []
  const failedArtists: string[] = []
  const logs: PipelineLogEntry[] = []
  const artistIdsSet = new Set(artistIds)
  const excludeSet = excludeTrackIds || new Set<string>()

  const log = (
    level: PipelineLogEntry['level'],
    message: string,
    details?: any
  ) => {
    logs.push(createPipelineLog('engine', level, message, details))
    // Also mirror to console for now
    if (level === 'error')
      logger('ERROR', message, 'fetchTopTracksForArtists', details)
    else if (level === 'warn')
      logger('WARN', message, 'fetchTopTracksForArtists')
    else logger('INFO', message, 'fetchTopTracksForArtists')
  }

  log(
    'info',
    `fetchTopTracksForArtists: Requested ${artistIds.length} artists`,
    { artistIds }
  )

  // Record requests for all artists
  artistIds.forEach(() => {
    statisticsTracker?.recordRequest('topTracks')
  })

  // 1. Batch query DB
  const dbTopTracks = await timeDbQuery(
    `batchGetTopTracksFromDb (${artistIds.length} artists)`,
    () => batchGetTopTracksFromDb(artistIds, token, statisticsTracker)
  )

  // Record cache hits for artists found in database
  artistIds.forEach((artistId) => {
    if (dbTopTracks.has(artistId)) {
      statisticsTracker?.recordCacheHit('topTracks', 'database')
    }
  })

  // 2. Identify missing
  const missingArtistIds = artistIds.filter((id) => !dbTopTracks.has(id))
  log(
    'info',
    `DB Cache: Found ${dbTopTracks.size} artists, Missing ${missingArtistIds.length}`
  )

  // 3. Fetch missing from Spotify
  if (missingArtistIds.length > 0) {
    const MAX_MISSING_TO_FETCH = 10 // Increased from 5 to 10 for better coverage
    const artistsToFetch = missingArtistIds.slice(0, MAX_MISSING_TO_FETCH)

    if (missingArtistIds.length > MAX_MISSING_TO_FETCH) {
      log(
        'warn',
        `Too many missing artists (${missingArtistIds.length}). Only fetching first ${MAX_MISSING_TO_FETCH}.`
      )
    }

    log(
      'info',
      `Fetching ${artistsToFetch.length} missing artists from Spotify`,
      { artistsToFetch }
    )

    await Promise.all(
      artistsToFetch.map(async (artistId) => {
        try {
          const tracks = await timeApiCall(
            `getArtistTopTracksServer (${artistId})`,
            () => getArtistTopTracksServer(artistId, token, statisticsTracker)
          )

          if (tracks.length === 0) {
            log('warn', `Spotify API returned 0 tracks for artist ${artistId}`)
          } else {
            log(
              'info',
              `Fetched ${tracks.length} tracks for artist ${artistId} from Spotify`
            )
            // Fire and forget upserts but log them
            // Ensure we catch errors in fire-and-forget to avoid unhandled rejections
            const pUpsert = Promise.all([
              upsertTopTracks(
                artistId,
                tracks.map((t) => t.id)
              ),
              upsertTrackDetails(tracks)
            ]).catch((err) => {
              logger(
                'ERROR',
                `Upsert failed for artist ${artistId}: ${err.message}`,
                'fetchTopTracksForArtists'
              )
            })

            dbTopTracks.set(artistId, tracks)
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          log('error', `Failed to fetch top tracks for artist ${artistId}`, {
            error: errMsg
          })

          // Queue for healing if fetch failed
          void enqueueLazyUpdate({
            type: 'artist_top_tracks',
            spotifyId: artistId,
            payload: { needsRefresh: true, reason: 'fetch_failed' }
          })
        }
      })
    )
  }

  // 4. Build seeds - randomly select 1 track from top 10 per artist
  // Track which artists are missing from dbTopTracks entirely
  const artistsWithNoData = artistIds.filter((id) => !dbTopTracks.has(id))

  dbTopTracks.forEach((tracks, artistId) => {
    // Only if requested
    if (!artistIdsSet.has(artistId)) return

    // Get top 10 tracks (or all available if less than 10)
    const topTracks = tracks.slice(0, 10)

    // Filter out excluded tracks (current track, played tracks)
    // Filter out excluded tracks (current track, played tracks)
    let playedCount = 0
    let unplayableCount = 0
    let currentTrackCount = 0

    const validTracks = topTracks.filter((track) => {
      // Check playability
      if (!track.is_playable) {
        unplayableCount++
        return false
      }

      // Check if in exclude set
      if (excludeSet.has(track.id)) {
        if (token && excludeSet.has(track.id)) {
          // Technically excludeSet doesn't know *why* it's excluded (could be current or played)
          // But usually excludeSet = current + played.
          // Let's assume played/current.
          // To be precise, we can't easily distinguish 'current' vs 'played' from just the set check
          // unless we pass them separately, but for now 'Already Played/Queued' is sufficient.
          playedCount++
        } else {
          playedCount++
        }
        return false
      }

      return true
    })

    // Log filtering results
    const excludedCount = topTracks.length - validTracks.length
    if (excludedCount > 0) {
      log(
        'info',
        `Filtered ${excludedCount}/${topTracks.length} tracks for artist ${artistId}: ${unplayableCount} unplayable, ${playedCount} already played/queued`
      )
    }

    // If no valid tracks, queue for healing (REQ-DAT-03: Self-Healing Queue)
    if (validTracks.length === 0) {
      log(
        'warn',
        `No valid tracks for artist ${artistId} after filtering. Total fetched: ${topTracks.length}`
      )

      // REQ-DAT-03: Queue metadata gap for asynchronous resolution
      void enqueueLazyUpdate({
        type: 'artist_top_tracks',
        spotifyId: artistId,
        payload: {
          needsRefresh: true,
          reason: 'no_valid_tracks',
          totalTracks: topTracks.length,
          filteredCount: topTracks.length - validTracks.length
        }
      })

      failedArtists.push(artistId)
      return
    }

    // Randomly select 1 track from valid tracks
    const randomIndex = Math.floor(Math.random() * validTracks.length)
    const selectedTrack = validTracks[randomIndex]

    seeds.push({
      track: selectedTrack,
      source: 'related_top_tracks',
      seedArtistId: artistId
    })
  })

  // Queue artists with no data in database for healing
  artistsWithNoData.forEach((artistId) => {
    if (!failedArtists.includes(artistId)) {
      log('warn', `No data found in DB or Spotify for artist ${artistId}`)
      void enqueueLazyUpdate({
        type: 'artist_top_tracks',
        spotifyId: artistId,
        payload: {
          needsRefresh: true,
          reason: 'missing_from_database'
        }
      })
      failedArtists.push(artistId)
    }
  })

  log(
    'info',
    `fetchTopTracksForArtists complete. Seeds: ${seeds.length}, Failed: ${failedArtists.length}`
  )

  return { seeds, failedArtists, logs }
}

function computeVicinityDistances(
  candidate: ArtistProfile,
  targetProfiles: Record<PlayerId, TargetProfile | null>,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
) {
  return { p1: 1, p2: 1 }
}

export async function getSeedRelatedArtists(
  artistId: string,
  token?: string
): Promise<Array<{ id: string; name: string }>> {
  if (!token) return []

  try {
    const related = await getRelatedArtistsWithCache(artistId, () =>
      getRelatedArtistsServer(artistId, token)
    )
    return related.map((a) => ({
      id: a.id,
      name: a.name
    }))
  } catch (err) {
    logger(
      'WARN',
      `Failed to get seed related artists for ${artistId}`,
      undefined,
      err as Error
    )
    return []
  }
}
