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
  upsertTrackDetails
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
import { getRelatedArtistsForGame } from '../gameService'
import {
  getArtistTopTracksServer,
  getRelatedArtistsServer,
  searchTracksByGenreServer
} from '../spotifyApiServer'
import {
  fetchRandomTracksFromDb,
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

export function normalizeGravities(
  gravities: PlayerGravityMap
): PlayerGravityMap {
  return {
    player1: clampGravity(gravities.player1 ?? DEFAULT_PLAYER_GRAVITY),
    player2: clampGravity(gravities.player2 ?? DEFAULT_PLAYER_GRAVITY)
  }
}

function clampGravity(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_PLAYER_GRAVITY
  }
  if (value < GRAVITY_LIMITS.min) {
    return GRAVITY_LIMITS.min
  }
  if (value > GRAVITY_LIMITS.max) {
    return GRAVITY_LIMITS.max
  }
  return value
}

function isValidSpotifyId(id: string | undefined): boolean {
  if (!id) return false
  // Spotify IDs are 22-char base62 strings (letters + digits, no dashes)
  return id.length === 22 && /^[0-9A-Za-z]+$/.test(id)
}

/**
 * Add target artists to candidate pool when gravity is high enough or rounds are late
 * This ensures target artists have a chance to appear as options
 */
async function addTargetArtistsToPool({
  candidatePool,
  targetProfiles,
  playerGravities,
  roundNumber,
  currentTrackId,
  playedTrackIds,
  token,
  statisticsTracker
}: {
  candidatePool: CandidateSeed[]
  targetProfiles: Record<PlayerId, TargetProfile | null>
  playerGravities: PlayerGravityMap
  roundNumber: number
  currentTrackId: string
  playedTrackIds: string[]
  token: string
  statisticsTracker: ApiStatisticsTracker
}): Promise<CandidateSeed[]> {
  const additionalCandidates: CandidateSeed[] = []

  // Thresholds: add if gravity >= 0.80 OR round >= 8
  // Note: Desperation logic (<0.2) is now handled by Stage 1 seeding related artists
  const GRAVITY_THRESHOLD = 0.8
  const ROUND_THRESHOLD = 8

  // Check if we should add target artists (Target Artist Itself)
  const shouldAdd =
    playerGravities.player1 >= GRAVITY_THRESHOLD ||
    playerGravities.player2 >= GRAVITY_THRESHOLD ||
    roundNumber >= ROUND_THRESHOLD

  if (!shouldAdd) {
    return additionalCandidates
  }

  logger(
    'INFO',
    `Checking target artists for pool addition: P1 gravity=${(Number(playerGravities.player1) ?? 0).toFixed(3)}, P2 gravity=${(Number(playerGravities.player2) ?? 0).toFixed(3)}, Round=${roundNumber}`
  )

  // Check which target artists are already in the pool
  const existingArtistIds = new Set<string>()
  candidatePool.forEach((c) => {
    const artistId = c.track.artists?.[0]?.id
    if (artistId && isValidSpotifyId(artistId)) {
      existingArtistIds.add(artistId)
    }
  })

  const excludeTrackIds = new Set<string>([currentTrackId, ...playedTrackIds])
  candidatePool.forEach((c) => {
    if (c.track.id) excludeTrackIds.add(c.track.id)
  })

  // Process each target profile
  for (const [playerId, targetProfile] of Object.entries(targetProfiles)) {
    if (!targetProfile?.spotifyId) continue

    // Check if target artist is already in pool
    if (existingArtistIds.has(targetProfile.spotifyId)) {
      logger(
        'INFO',
        `Target artist ${targetProfile.artist.name} already in pool`
      )
      continue
    }

    // Check if this player's gravity is high enough OR round threshold met
    const playerGravity = playerGravities[playerId as PlayerId]
    const playerShouldAdd =
      playerGravity >= GRAVITY_THRESHOLD || roundNumber >= ROUND_THRESHOLD

    if (!playerShouldAdd) {
      continue
    }

    try {
      logger(
        'INFO',
        `Adding target artist ${targetProfile.artist.name} to pool (gravity=${playerGravity.toFixed(3)}, round=${roundNumber})`
      )

      // Unified Service Call with metrics tracking
      const { data: tracks, source } = await musicService.getTopTracks(
        targetProfile.spotifyId,
        token,
        statisticsTracker
      )

      logger(
        'INFO',
        `Found ${tracks.length} tracks for ${targetProfile.artist.name} via ${source}`
      )

      // Filter out played tracks and current track
      const validTracks = tracks.filter((track) => {
        if (!track.id || excludeTrackIds.has(track.id)) return false
        if (!track.is_playable) return false
        return true
      })

      if (validTracks.length > 0) {
        // Add top track (or first valid track)
        const trackToAdd = validTracks[0]
        additionalCandidates.push({
          track: trackToAdd,
          source: 'target_boost'
        })
        logger(
          'INFO',
          `Added target artist track: ${trackToAdd.name} by ${targetProfile.artist.name}`
        )
      } else {
        logger(
          'WARN',
          `No valid tracks found for target artist ${targetProfile.artist.name}`
        )
      }
    } catch (error) {
      logger(
        'WARN',
        `Failed to add target artist ${targetProfile.artist.name} to pool`,
        'addTargetArtistsToPool',
        error instanceof Error ? error : undefined
      )
    }
  }

  if (additionalCandidates.length > 0) {
    logger(
      'INFO',
      `Target artists: Added ${additionalCandidates.length} target artist tracks to candidate pool`
    )
  }

  return additionalCandidates
}

/**
 * Ensure candidate pool has diverse attraction profiles relative to targets
 * Database-first approach: uses database queries to find closer/further candidates
 * Only called when existing pool lacks diversity in attraction scores
 */
export async function ensureTargetDiversity({
  candidatePool,
  targetProfiles,
  currentSongAttraction,
  currentPlayerId,
  currentTrackId,
  playedTrackIds,
  artistProfiles,
  artistRelationships,
  token,
  statisticsTracker,
  currentArtistId
}: {
  candidatePool: CandidateSeed[]
  targetProfiles: Record<PlayerId, TargetProfile | null>
  currentSongAttraction: number
  currentPlayerId: PlayerId
  currentTrackId: string
  playedTrackIds: string[]
  artistProfiles: Map<string, ArtistProfile>
  artistRelationships: Map<string, Set<string>>
  token: string
  statisticsTracker: ApiStatisticsTracker
  currentArtistId?: string
}): Promise<CandidateSeed[]> {
  const additionalCandidates: CandidateSeed[] = []
  const currentPlayerTarget = targetProfiles[currentPlayerId]

  if (!currentPlayerTarget) {
    logger(
      'INFO',
      'No target profile for current player, skipping target diversity check'
    )
    return additionalCandidates
  }

  // Compute attraction for all existing candidates
  const candidateAttractions: Array<{
    candidate: CandidateSeed
    attraction: number
    diff: number
  }> = []

  for (const candidate of candidatePool) {
    const artistId = candidate.track.artists?.[0]?.id
    if (!artistId) continue

    const artistProfile = artistProfiles.get(artistId)
    if (!artistProfile) continue

    const attraction = computeAttraction(
      artistProfile,
      currentPlayerTarget,
      artistProfiles,
      artistRelationships
    )

    const diff = attraction - currentSongAttraction
    candidateAttractions.push({ candidate, attraction, diff })
  }

  // Count candidates in each category
  // Strict diversity thresholds to match user expectation:
  // Good: > Current (strictly better)
  // Neutral: ~= Current (similar)
  // Bad: < Current (strictly worse)
  // We use a small epsilon for "Neutral" to account for floating point noise, but conceptually it's "Same Level"
  const NEUTRAL_EPSILON = 0.05
  const closerCount = candidateAttractions.filter(
    (item) => item.diff > NEUTRAL_EPSILON
  ).length
  const furtherCount = candidateAttractions.filter(
    (item) => item.diff < -NEUTRAL_EPSILON
  ).length
  const neutralCount = candidateAttractions.filter(
    (item) => Math.abs(item.diff) <= NEUTRAL_EPSILON
  ).length

  // We strictly want 3 of each in the final display (9 total)
  // Asking for slightly more (5) to allow for filtering/dupes/played tracks
  const TARGET_COUNT_PER_CATEGORY = 5

  logger(
    'INFO',
    `Target diversity check (Strict 3:3:3 target): Closer=${closerCount}, Neutral=${neutralCount}, Further=${furtherCount}, Baseline=${currentSongAttraction.toFixed(3)}`
  )

  // Get exclusion sets
  const excludeArtistIds = new Set<string>()
  candidatePool.forEach((c) => {
    const artistId = c.track.artists?.[0]?.id
    if (artistId && isValidSpotifyId(artistId)) {
      excludeArtistIds.add(artistId)
    }
  })
  const excludeTrackIds = new Set<string>([currentTrackId, ...playedTrackIds])
  candidatePool.forEach((c) => {
    if (c.track.id) excludeTrackIds.add(c.track.id)
  })

  // === STRATEGY 1: INJECT GOOD CANDIDATES (Target Artist Focus) ===
  if (closerCount < TARGET_COUNT_PER_CATEGORY) {
    const needed = TARGET_COUNT_PER_CATEGORY - closerCount
    logger(
      'INFO',
      `Injecting 'Good' candidates (Need ${needed}). Strategy: Target Artist & Related`
    )

    // NOTE: Target Artist injection removed from this function
    // Target artists are now ONLY injected via addTargetArtistsToPool() which properly checks:
    // - Gravity >= 80% OR Round >= 8
    // This ensures target artists don't appear too early in the game
    // This function (ensureTargetDiversity) should only inject RELATED artists for diversity

    // 1. Related Artists of Target (for diversity)
    // Only do this if we haven't filled the quota
    // Note: No longer counting target_insertion since we removed that code above
    const currentCloserCount = closerCount + additionalCandidates.length
    if (
      currentCloserCount < TARGET_COUNT_PER_CATEGORY &&
      currentPlayerTarget?.spotifyId
    ) {
      try {
        // Fetch related artists
        const { data: relatedArtists, source: relSource } =
          await musicService.getRelatedArtists(
            currentPlayerTarget.spotifyId,
            token
          )

        // Take top 3 related artists we haven't seen
        const usefulRelated = relatedArtists
          .filter((a) => !excludeArtistIds.has(a.id))
          .slice(0, 3)

        for (const artist of usefulRelated) {
          const { data: tracks, source } = await musicService.getTopTracks(
            artist.id,
            token,
            statisticsTracker
          )

          const validTrack = tracks.find(
            (t) => t.id && !excludeTrackIds.has(t.id) && t.is_playable
          )
          if (validTrack) {
            additionalCandidates.push({
              track: validTrack,
              source: 'related_artist_insertion'
            })
            excludeTrackIds.add(validTrack.id)
            logger(
              'INFO',
              `Added Related Artist track: ${validTrack.name} by ${artist.name}`
            )
          }
          if (additionalCandidates.length >= needed + 3) break // formatting buffer
        }
      } catch (err) {
        logger(
          'WARN',
          `Failed to inject Target Related Artists`,
          'ensureTargetDiversity',
          err instanceof Error ? err : undefined
        )
      }
    }

    // 3. Genre Fallback for Target (if we still need more options)
    const countAfterRelated = closerCount + additionalCandidates.length
    if (
      countAfterRelated < TARGET_COUNT_PER_CATEGORY &&
      currentPlayerTarget?.genres &&
      currentPlayerTarget.genres.length > 0
    ) {
      try {
        const needed = TARGET_COUNT_PER_CATEGORY - countAfterRelated
        logger(
          'INFO',
          `Still need ${needed} 'Good' candidates. Strategy: Genre Fallback (${currentPlayerTarget.genres.slice(0, 2).join(', ')})`
        )

        // Search for tracks matching these genres
        const limit = Math.max(20, needed * 4)
        const { data: genreOptionTracks, source } =
          await musicService.searchTracksByGenre(
            currentPlayerTarget.genres,
            token,
            limit
          )

        // Cache found tracks is handled by service

        // Extract trackDetails from option tracks
        const genreTracks = genreOptionTracks.map((o) => o.track)

        // Add valid tracks
        let added = 0
        for (const track of genreTracks) {
          // Ensure it's not a duplicate track
          if (track.id && !excludeTrackIds.has(track.id) && track.is_playable) {
            additionalCandidates.push({ track, source: 'target_insertion' })
            excludeTrackIds.add(track.id)
            added++
            if (added >= needed) break
          }
        }

        if (added > 0) {
          logger('INFO', `Added ${added} tracks from Target Genre Fallback`)
        } else {
          logger('WARN', `Genre Fallback found 0 valid tracks`)
        }
      } catch (err) {
        logger(
          'WARN',
          `Failed to inject Target Genre tracks`,
          'ensureTargetDiversity',
          err instanceof Error ? err : undefined
        )
      }
    }
  }

  // === STRATEGY 2: INJECT NEUTRAL CANDIDATES (Current Artist Focus) ===
  if (neutralCount < TARGET_COUNT_PER_CATEGORY) {
    const needed = TARGET_COUNT_PER_CATEGORY - neutralCount
    logger(
      'INFO',
      `Injecting 'Neutral' candidates (Need ${needed}). Strategy: Current Artist & Related`
    )

    if (currentArtistId) {
      // 1. Current Artist Top Tracks
      try {
        const { data: tracks, source } = await musicService.getTopTracks(
          currentArtistId,
          token,
          statisticsTracker
        )

        const validTracks = tracks.filter(
          (t) =>
            t.id &&
            !excludeTrackIds.has(t.id) &&
            t.is_playable &&
            t.id !== currentTrackId
        )
        validTracks.forEach((track) => {
          additionalCandidates.push({ track, source: 'related_top_tracks' })
          excludeTrackIds.add(track.id)
        })
        if (validTracks.length > 0) {
          logger(
            'INFO',
            `Added ${validTracks.length} tracks from Current Artist for Neutral category`
          )
        } else {
          logger(
            'WARN',
            `Current Artist has no valid tracks for Neutral category (filtered or empty)`
          )
        }
      } catch (e) {
        logger(
          'WARN',
          `Failed to inject Current Artist tracks`,
          'ensureTargetDiversity',
          e instanceof Error ? e : undefined
        )
      }

      // 2. Related Artists of Current (if needed)
      if (additionalCandidates.length < needed) {
        try {
          const { data: relatedArtists, source: relSource } =
            await musicService.getRelatedArtists(currentArtistId, token)

          // Filter valid related artists
          const usefulRelated = relatedArtists
            .filter((a) => !excludeArtistIds.has(a.id))
            .slice(0, 3)

          for (const artist of usefulRelated) {
            const { data: tracks, source } = await musicService.getTopTracks(
              artist.id,
              token,
              statisticsTracker
            )

            const validTrack = tracks.find(
              (t) => t.id && !excludeTrackIds.has(t.id) && t.is_playable
            )
            if (validTrack) {
              additionalCandidates.push({
                track: validTrack,
                source: 'related_top_tracks'
              })
              excludeTrackIds.add(validTrack.id)
              logger(
                'INFO',
                `Added Related Artist track: ${validTrack.name} by ${artist.name}`
              )
            }
            if (additionalCandidates.length >= needed * 2) break
          }
        } catch (e) {
          logger(
            'WARN',
            `Failed to inject Current Related Artists`,
            'ensureTargetDiversity',
            e instanceof Error ? e : undefined
          )
        }
      }
    } else {
      logger(
        'WARN',
        'Cannot inject Neutral candidates: currentArtistId missing'
      )
    }
  }

  // === STRATEGY 3: FALLBACK FURTHER CANDIDATES (Random/Diverse) ===
  if (furtherCount < TARGET_COUNT_PER_CATEGORY) {
    const needed = Math.max(5, TARGET_COUNT_PER_CATEGORY - furtherCount) // Ask for more to ensure valid ones
    logger(
      'INFO',
      `Injecting 'Further/Bad' candidates (Need ${needed}). Strategy: Database Embeddings/Random`
    )

    // Use existing DB strategy for further
    try {
      // 1. Try "Further" specifically (anti-affinity if we had embeddings, but here random/far genres)
      const dbResult = await fetchTracksFurtherFromTarget({
        targetGenres: currentPlayerTarget.genres,
        excludeArtistIds,
        excludeTrackIds,
        limit: needed * 2 // Over-fetch
      })

      let added = 0
      dbResult.tracks.forEach((track) => {
        if (track.id && !excludeTrackIds.has(track.id)) {
          additionalCandidates.push({ track, source: 'embedding' })
          excludeTrackIds.add(track.id)
          added++
        }
      })

      logger('INFO', `Added ${added} 'Further' tracks from DB`)

      // 2. If still not enough, just grab random tracks (guaranteed "Bad" usually)
      if (added < needed) {
        const stillNeeded = needed - added
        const randomResult = await fetchRandomTracksFromDb({
          neededArtists: stillNeeded,
          existingArtistNames: new Set(),
          excludeSpotifyTrackIds: excludeTrackIds,
          tracksPerArtist: 1
        })

        randomResult.tracks.forEach((track) => {
          if (track.id && !excludeTrackIds.has(track.id)) {
            additionalCandidates.push({ track, source: 'embedding' }) // misuse embedding source for random
            excludeTrackIds.add(track.id)
          }
        })
        logger(
          'INFO',
          `Added ${randomResult.tracks.length} additional random tracks for 'Further'`
        )
      }
    } catch (e) {
      logger(
        'WARN',
        'Failed to fetch further tracks',
        'ensureTargetDiversity',
        e instanceof Error ? e : undefined
      )
    }
  }

  // Final fetch of profiles for all new candidates to ensure scoring works later
  // ... (existing code handles this by returning candidates, caller handles enrichment? No, caller expects seeds)
  // `runDualGravityEngine` handles enrichment of Returned candidates:
  /*
    if (diversityCandidates.length > 0) {
      // Enrich new candidates with artist profiles
      ...
    }
  */
  // So I just need to return `additionalCandidates`.

  return additionalCandidates
}

async function buildCandidatePool({
  playbackState,
  currentTrackId,
  seedArtistId,
  token,
  playedTrackIds,
  currentArtistId,
  statisticsTracker
}: {
  playbackState: SpotifyPlaybackState
  currentTrackId: string
  seedArtistId: string
  token: string
  playedTrackIds: string[]
  currentArtistId: string
  statisticsTracker: ApiStatisticsTracker
}): Promise<{
  pool: CandidateSeed[]
  dbFallback: {
    used: boolean
    addedTracks: number
    addedArtists: number
  }
}> {
  // Track start time to avoid timeout (Hobby ~10s budget)
  const startTime = Date.now()
  const MAX_BUILD_TIME_MS = 8500 // leave buffer for scoring/processing

  const quickDbFallback = async (
    reason: string
  ): Promise<{
    pool: CandidateSeed[]
    dbFallback: {
      used: boolean
      addedTracks: number
      addedArtists: number
      reason?: string
    }
  }> => {
    logger(
      'WARN',
      `Deadline reached (${reason}). Using quick DB fallback with minimal candidates.`,
      'buildCandidatePool'
    )

    const excludeIds = new Set<string>([currentTrackId, ...playedTrackIds])
    const existingArtistNames = new Set<string>()
    const dbResult = await fetchRandomTracksFromDb({
      neededArtists: 6,
      existingArtistNames,
      excludeSpotifyTrackIds: excludeIds,
      tracksPerArtist: 1
    })

    const fallbackMap = new Map<string, CandidateSeed>()
    dbResult.tracks.forEach((track) => {
      registerCandidate(
        track,
        'embedding',
        fallbackMap,
        playedTrackIds,
        currentArtistId
      )
    })

    const pool = Array.from(fallbackMap.values()).slice(0, MAX_CANDIDATE_POOL)
    return {
      pool,
      dbFallback: {
        used: true,
        addedTracks: pool.length,
        addedArtists: dbResult.uniqueArtistsAdded ?? pool.length,
        reason: 'deadline'
      }
    }
  }

  if (hasExceededDeadline(startTime)) {
    return quickDbFallback('pre-related-artists')
  }

  // Get related artists using unified music service (Mem -> Graph -> Spotify)
  // MusicService handles all the hybrid logic internally and tracks metrics
  const { data: relatedArtists } = await musicService.getRelatedArtists(
    seedArtistId,
    token,
    statisticsTracker
  )
  const candidateMap = new Map<string, CandidateSeed>()

  if (hasExceededDeadline(startTime)) {
    return quickDbFallback('post-related-artists')
  }

  // Track source diversity during collection
  const sourceDiversityTracker = {
    counts: { ...DIVERSITY_SOURCES },
    targets: Object.fromEntries(
      Object.entries(DIVERSITY_SOURCES).map(([key, percentage]) => [
        key,
        Math.round(MIN_CANDIDATE_POOL * percentage)
      ])
    ) as Record<keyof typeof DIVERSITY_SOURCES, number>,

    // Map existing sources to diversity categories
    mapSourceToCategory(
      source: CandidateSource
    ): keyof typeof DIVERSITY_SOURCES {
      switch (source) {
        case 'recommendations':
          return 'directRecommendations'
        case 'related_top_tracks':
          return 'relatedArtists'
        case 'target_insertion':
        case 'target_boost':
          return 'genreNeighbors'
        case 'embedding':
        default:
          return 'popularityVaried'
      }
    },

    // Check if we should prioritize underrepresented sources
    shouldPrioritizeUnderrepresented(): boolean {
      const totalCurrent = Object.values(this.counts).reduce((a, b) => a + b, 0)
      if (totalCurrent < MIN_CANDIDATE_POOL * 0.3) return false // Don't prioritize too early

      const underrepresented = Object.entries(this.counts).filter(
        ([key, current]) =>
          current < this.targets[key as keyof typeof this.targets]
      )
      return underrepresented.length > 0
    },

    // Get the most underrepresented category
    getMostUnderrepresentedCategory(): keyof typeof DIVERSITY_SOURCES | null {
      let mostUnderrepresented: keyof typeof DIVERSITY_SOURCES | null = null
      let maxDeficit = 0

      for (const [key, current] of Object.entries(this.counts)) {
        const target = this.targets[key as keyof typeof this.targets]
        const deficit = target - current
        if (deficit > maxDeficit) {
          maxDeficit = deficit
          mostUnderrepresented = key as keyof typeof DIVERSITY_SOURCES
        }
      }

      return mostUnderrepresented
    },

    // Update counts when adding a candidate
    addCandidate(source: CandidateSource): void {
      const category = this.mapSourceToCategory(source)
      this.counts[category]++
    },

    // Log current diversity status
    logStatus(context: string): void {
      const totalCurrent = Object.values(this.counts).reduce((a, b) => a + b, 0)
      const status = Object.entries(this.counts)
        .map(([key, current]) => {
          const target = this.targets[key as keyof typeof this.targets]
          return `${key}=${current}/${target}`
        })
        .join(', ')

      logger(
        'INFO',
        `Source diversity [${context}]: ${status} | Total=${totalCurrent}`,
        'sourceDiversityTracker'
      )
    }
  }

  // Initialize diversity tracker
  Object.keys(sourceDiversityTracker.counts).forEach((key) => {
    sourceDiversityTracker.counts[key as keyof typeof DIVERSITY_SOURCES] = 0
  })

  resetFilteringStats()

  const seedArtistName = playbackState.item?.artists?.[0]?.name ?? 'Unknown'
  logger(
    'INFO',
    `Building candidate pool: SeedArtist=${seedArtistName} (${seedArtistId}) | CurrentTrack=${currentTrackId} | PlayedTracks=${playedTrackIds.length} | RelatedArtists=${relatedArtists.length} | TargetUniqueArtists=${MIN_UNIQUE_ARTISTS}`
  )

  // PRIORITY 1: Fetch top tracks from discovered related artists
  // This uses the results from the hybrid artist discovery system
  logger(
    'INFO',
    `Processing ${relatedArtists.length} related artists from hybrid discovery`
  )

  // Start with smaller batch to get initial results faster
  let startIndex = 0
  let batchSize = 30 // Start smaller for faster initial response

  // Fetch in batches until we have enough unique artists AND enough tracks
  let uniqueArtists = 0
  let totalTracks = 0

  // Use full target to ensure we get enough candidates
  const targetUniqueArtists = MIN_UNIQUE_ARTISTS

  while (
    (uniqueArtists < targetUniqueArtists || totalTracks < MIN_CANDIDATE_POOL) &&
    startIndex < relatedArtists.length
  ) {
    // Check elapsed time - bail out early if taking too long
    const elapsed = Date.now() - startTime
    if (hasExceededDeadline(startTime)) {
      return quickDbFallback('related-artist-loop')
    }
    if (elapsed > MAX_BUILD_TIME_MS * 0.35) {
      // 35% of budget
      logger(
        'WARN',
        `Stopping related artist fetch early due to time constraint (${(elapsed / 1000).toFixed(1)}s elapsed). Will use DB fallback for remainder.`
      )
      break
    }

    const endIndex = Math.min(startIndex + batchSize, relatedArtists.length)
    const batch = relatedArtists.slice(startIndex, endIndex)

    if (batch.length === 0) break

    const beforeSize = candidateMap.size
    await addRelatedArtistTracks({
      relatedArtists: batch,
      token,
      candidateMap,
      playedTrackIds,
      currentArtistId,
      tracksPerArtist: 2,
      statisticsTracker,
      deadline: startTime + MAX_BUILD_TIME_MS * 0.5 // aggressive deadline
    })
    const afterSize = candidateMap.size
    const added = afterSize - beforeSize

    uniqueArtists = countUniqueArtists(candidateMap)
    totalTracks = candidateMap.size

    logger(
      'INFO',
      `Related artists batch ${startIndex}-${endIndex}: Added ${added} tracks, Total: ${totalTracks} tracks (target: ${MIN_CANDIDATE_POOL}), Unique artists: ${uniqueArtists}/${targetUniqueArtists}`
    )

    // If we have enough unique artists AND enough tracks, stop
    if (
      uniqueArtists >= targetUniqueArtists &&
      totalTracks >= MIN_CANDIDATE_POOL
    ) {
      logger(
        'INFO',
        `Candidate pool targets met: ${uniqueArtists} artists (min ${targetUniqueArtists}), ${totalTracks} tracks (min ${MIN_CANDIDATE_POOL})`
      )
      break
    }

    // Expand to next batch
    startIndex = endIndex
    // Increase batch size for subsequent batches to speed up
    if (startIndex > 50) {
      batchSize = 100
    }
  }

  logger(
    'INFO',
    `After related artists: ${totalTracks} tracks, ${uniqueArtists} unique artists`
  )
  sourceDiversityTracker.logStatus('after_related_artists')

  // Check elapsed time to avoid timeout (skip expensive operations if > 30s)
  const elapsedTime = Date.now() - startTime
  const skipExpensiveOperations = elapsedTime > MAX_BUILD_TIME_MS * 0.45
  if (skipExpensiveOperations) {
    logger(
      'WARN',
      `Running low on time (${(elapsedTime / 1000).toFixed(1)}s elapsed). Will skip expensive operations and use DB fallback.`
    )
  }

  // PRIORITY 2: Supplement with DB genre search ONLY if related artists insufficient
  // This ensures we use the hybrid discovery results first
  const finalTargetUniqueArtists = MIN_UNIQUE_ARTISTS
  if (uniqueArtists < finalTargetUniqueArtists) {
    logger(
      'INFO',
      `Related artists provided ${uniqueArtists} unique artists, supplementing with DB genre search`
    )

    statisticsTracker?.recordRequest('artistProfiles')
    const seedArtistProfile = await fetchArtistProfile(
      seedArtistId,
      token,
      statisticsTracker
    )
    const seedGenres = seedArtistProfile?.genres ?? []

    if (seedGenres.length > 0) {
      logger(
        'INFO',
        `DB supplement with genres: ${seedGenres.slice(0, 3).join(', ')}`
      )
      const excludeIds = new Set([currentTrackId, ...playedTrackIds])

      const neededArtists = finalTargetUniqueArtists - uniqueArtists
      // Calculate how many tracks we need to reach MIN_CANDIDATE_POOL
      const neededTracks = Math.max(0, MIN_CANDIDATE_POOL - totalTracks)
      const dbResult = await fetchTracksByGenreFromDb({
        genres: seedGenres,
        minPopularity: 15,
        maxPopularity: 100,
        limit: Math.max(neededArtists * 1.2, neededTracks, 50), // Fetch enough to supplement both artists and tracks
        excludeSpotifyTrackIds: excludeIds
      })

      if (dbResult.tracks.length > 0) {
        logger(
          'INFO',
          `DB supplement: Found ${dbResult.tracks.length} tracks for ${dbResult.uniqueArtists} unique artists`
        )
        dbResult.tracks.forEach((track) => {
          registerCandidate(
            track,
            'related_top_tracks',
            candidateMap,
            playedTrackIds,
            currentArtistId
          )
        })

        uniqueArtists = countUniqueArtists(candidateMap)
        totalTracks = candidateMap.size
        logger(
          'INFO',
          `After DB supplement: ${totalTracks} tracks, ${uniqueArtists} unique artists`
        )
      }
    } else {
      // No genres available, use random DB tracks
      logger(
        'INFO',
        'No genres available, using random DB tracks to supplement'
      )
      const excludeIds = new Set([currentTrackId, ...playedTrackIds])
      const existingArtistNames = new Set<string>()
      candidateMap.forEach((candidate) => {
        const name = candidate.track.artists?.[0]?.name
        if (name) {
          existingArtistNames.add(name.trim().toLowerCase())
        }
      })

      const neededArtists = finalTargetUniqueArtists - uniqueArtists
      const dbResult = await timeDbQuery(
        `fetchRandomTracksFromDb (${neededArtists} artists needed)`,
        () =>
          fetchRandomTracksFromDb({
            neededArtists: Math.min(neededArtists, 30),
            existingArtistNames,
            excludeSpotifyTrackIds: excludeIds
          })
      )

      if (dbResult.tracks.length > 0) {
        logger(
          'INFO',
          `DB random supplement: Found ${dbResult.tracks.length} random tracks`
        )
        dbResult.tracks.forEach((track) => {
          registerCandidate(
            track,
            'embedding',
            candidateMap,
            playedTrackIds,
            currentArtistId
          )
        })

        uniqueArtists = countUniqueArtists(candidateMap)
        totalTracks = candidateMap.size
      }
    }
  }

  // FINAL SAFETY CHECK: If we still don't have enough candidates, force random DB fill
  // This is critical for the "Candidate Pool: 1" bug
  if (totalTracks < MIN_CANDIDATE_POOL) {
    const deficit = MIN_CANDIDATE_POOL - totalTracks
    logger(
      'WARN',
      `Candidate pool still below minimum (${totalTracks}/${MIN_CANDIDATE_POOL}). Forcing random DB fill for ${deficit} tracks.`
    )

    const excludeIds = new Set([currentTrackId, ...playedTrackIds])
    // Add existing candidates to exclusion list to avoid duplicates
    candidateMap.forEach((c) => {
      if (c.track.id) excludeIds.add(c.track.id)
    })

    const existingArtistNames = new Set<string>()
    candidateMap.forEach((candidate) => {
      const name = candidate.track.artists?.[0]?.name
      if (name) {
        existingArtistNames.add(name.trim().toLowerCase())
      }
    })

    // We want mainly new artists to hit diversity goals
    const neededArtists = Math.max(5, Math.ceil(deficit / 2))

    try {
      const dbResult = await timeDbQuery(`forceRandomDbFill (${deficit})`, () =>
        fetchRandomTracksFromDb({
          neededArtists: neededArtists,
          existingArtistNames,
          excludeSpotifyTrackIds: excludeIds,
          tracksPerArtist: 2
        })
      )

      if (dbResult.tracks.length > 0) {
        logger(
          'INFO',
          `Forced DB fill added ${dbResult.tracks.length} tracks. Total before: ${totalTracks}`
        )
        dbResult.tracks.forEach((track) => {
          registerCandidate(
            track,
            'embedding',
            candidateMap,
            playedTrackIds,
            currentArtistId
          )
        })
        totalTracks = candidateMap.size
        logger('INFO', `Total after forced fill: ${totalTracks}`)
      } else {
        logger(
          'ERROR',
          `Forced DB fill failed to return any tracks. Database might be empty or connection failed.`
        )
      }
    } catch (err) {
      logger(
        'ERROR',
        `Error during forced DB fill`,
        'buildCandidatePool',
        err instanceof Error ? err : undefined
      )
    }
  }

  // Strategy 1: Skip expensive album fetching - database fallback will handle insufficient artists

  // Strategy 2: Use genre-based search to find similar tracks
  // Skip if running low on time
  if (uniqueArtists < MIN_UNIQUE_ARTISTS && !skipExpensiveOperations) {
    logger(
      'WARN',
      `Still insufficient unique artists (${uniqueArtists}/${MIN_UNIQUE_ARTISTS}). Trying genre-based search.`
    )

    // Get current artist's genres from their profile
    try {
      statisticsTracker?.recordRequest('artistProfiles')
      const currentArtistProfile = await fetchArtistProfile(
        seedArtistId,
        token,
        statisticsTracker
      )
      if (currentArtistProfile && currentArtistProfile.genres.length > 0) {
        logger(
          'INFO',
          `Searching for tracks in genres: ${currentArtistProfile.genres.join(', ')}`
        )
        const genreTracks = await searchTracksByGenreServer(
          currentArtistProfile.genres,
          token,
          50
        )

        // Cache tracks to database asynchronously
        void enqueueLazyUpdate({
          type: 'track_details',
          spotifyId: seedArtistId,
          payload: { tracks: genreTracks }
        })

        const beforeSize = candidateMap.size
        genreTracks.forEach((track) => {
          registerCandidate(
            track,
            'related_top_tracks',
            candidateMap,
            playedTrackIds,
            currentArtistId
          )
        })
        const afterSize = candidateMap.size
        uniqueArtists = countUniqueArtists(candidateMap)
        logger(
          'INFO',
          `Genre search: Added ${afterSize - beforeSize} tracks, unique artists: ${uniqueArtists}`
        )
      } else {
        logger('INFO', 'Seed artist has no genres, skipping genre-based search')
      }
    } catch (error) {
      logger(
        'WARN',
        'Failed genre-based search',
        'buildCandidatePool',
        error instanceof Error ? error : undefined
      )
    }
  }

  // Strategy 3: Multi-level traversal as last artist-based attempt
  if (
    uniqueArtists < MIN_UNIQUE_ARTISTS &&
    relatedArtists.length > 0 &&
    !skipExpensiveOperations
  ) {
    logger(
      'WARN',
      `Insufficient unique artists (${uniqueArtists}/${MIN_UNIQUE_ARTISTS}). Attempting multi-level traversal.`
    )

    // Get related artists of related artists (2 levels deep)
    const level2Artists: SpotifyArtist[] = []
    const processedIds = new Set<string>([seedArtistId])

    // Sample up to 10 related artists to get their related artists
    const sampleSize = Math.min(10, relatedArtists.length)

    // Parallelize fetching level 2 related artists instead of sequential
    // Each call still checks DB cache first before hitting Spotify API
    const level2Promises = []
    for (let i = 0; i < sampleSize && uniqueArtists < MIN_UNIQUE_ARTISTS; i++) {
      const artist = relatedArtists[i]
      if (!artist.id || processedIds.has(artist.id)) continue

      processedIds.add(artist.id)

      // Push promise to array instead of awaiting
      level2Promises.push(
        getRelatedArtistsServer(artist.id, token)
          .then((level2Related) => ({
            artistId: artist.id,
            level2Related,
            success: true
          }))
          .catch((error) => {
            logger(
              'WARN',
              `Failed to get level 2 related artists for ${artist.id}`,
              'buildCandidatePool'
            )
            return { artistId: artist.id, level2Related: [], success: false }
          })
      )
    }

    // Wait for all fetches to complete in parallel
    // Each call independently checks memory cache -> DB cache -> Spotify API
    const level2Results = await Promise.all(level2Promises)

    // Process all results
    for (const result of level2Results) {
      if (result.success) {
        for (const level2Artist of result.level2Related) {
          if (level2Artist.id && !processedIds.has(level2Artist.id)) {
            level2Artists.push(level2Artist)
            processedIds.add(level2Artist.id)
          }
        }
      }
    }

    // Level 2 expansion disabled to minimize Spotify API calls
    // Database fallback will be used to supplement candidates if needed
    const MAX_LEVEL_2_ARTISTS = 0 // Disabled (was 50)
    if (level2Artists.length > 0 && MAX_LEVEL_2_ARTISTS > 0) {
      logger(
        'INFO',
        `Found ${level2Artists.length} level 2 related artists, fetching tracks for ${MAX_LEVEL_2_ARTISTS}...`
      )
      const beforeSize = candidateMap.size
      await addRelatedArtistTracks({
        relatedArtists: level2Artists.slice(0, MAX_LEVEL_2_ARTISTS),
        token,
        candidateMap,
        playedTrackIds,
        currentArtistId,
        tracksPerArtist: 1,
        statisticsTracker
      })
      const afterSize = candidateMap.size
      uniqueArtists = countUniqueArtists(candidateMap)
      totalTracks = candidateMap.size
      logger(
        'INFO',
        `Level 2: Added ${afterSize - beforeSize} tracks, Total: ${totalTracks} tracks, Unique artists: ${uniqueArtists}`
      )
    } else if (level2Artists.length > 0) {
      logger(
        'INFO',
        `Skipping ${level2Artists.length} level 2 artists (level 2 expansion disabled to minimize API calls)`
      )
    }
  } else if (skipExpensiveOperations) {
    const currentElapsed = Date.now() - startTime
    logger(
      'WARN',
      `Skipping multi-level traversal to avoid timeout (${(currentElapsed / 1000).toFixed(1)}s elapsed). Jumping to database fallback.`
    )
  }

  if (hasExceededDeadline(startTime)) {
    return quickDbFallback('pre-db-fallback')
  }

  // Strategy 4: Database fallback to guarantee a healthy pool size
  const dbFallbackStats: {
    used: boolean
    addedTracks: number
    addedArtists: number
    reason?: 'genre_deficiency' | 'artist_deficiency' | 'absolute_fallback'
    requestedTracks?: number
  } = {
    used: false,
    addedTracks: 0,
    addedArtists: 0
  }

  // Database fallback with optimized settings (indexes added for performance)
  const DB_FALLBACK_THRESHOLD = 60 // reduce scope for faster fallback
  const DB_FALLBACK_MULTIPLIER = 1.2 // minimize query size

  // Use fallback if we don't have enough artists OR enough tracks
  if (
    uniqueArtists < DB_FALLBACK_THRESHOLD ||
    totalTracks < MIN_CANDIDATE_POOL
  ) {
    const elapsedBeforeFallback = Date.now() - startTime
    if (elapsedBeforeFallback > MAX_BUILD_TIME_MS * 0.85) {
      return quickDbFallback('db-fallback-time-budget')
    }
    const reason =
      uniqueArtists < DB_FALLBACK_THRESHOLD
        ? `Unique artists (${uniqueArtists}) below threshold (${DB_FALLBACK_THRESHOLD})`
        : `Total tracks (${totalTracks}) below minimum (${MIN_CANDIDATE_POOL})`
    logger('WARN', `${reason}. Using database fallback.`)

    // Calculate needed artists and tracks
    const neededArtists = Math.max(
      0,
      Math.ceil(
        (DB_FALLBACK_THRESHOLD - uniqueArtists) * DB_FALLBACK_MULTIPLIER
      )
    )
    const neededTracks = Math.max(0, MIN_CANDIDATE_POOL - totalTracks)
    // fetchRandomTracksFromDb can return multiple tracks per artist (default 2), so calculate artists needed
    const tracksPerArtist = 2
    const artistsForTracks = Math.ceil(neededTracks / tracksPerArtist)
    const totalNeeded = Math.max(neededArtists, artistsForTracks)

    const existingArtistNames = new Set<string>()
    candidateMap.forEach((candidate) => {
      const name = candidate.track.artists?.[0]?.name
      if (name) {
        existingArtistNames.add(name.trim().toLowerCase())
      }
    })

    const excludeIds = new Set<string>([currentTrackId, ...playedTrackIds])
    candidateMap.forEach((candidate) => {
      if (candidate.track.id) {
        excludeIds.add(candidate.track.id)
      }
    })

    const dbResult = await timeDbQuery(
      `fetchRandomTracksFromDb - main fallback (${totalNeeded} artists, ${neededTracks} tracks needed)`,
      () =>
        fetchRandomTracksFromDb({
          neededArtists: Math.min(totalNeeded, 40),
          existingArtistNames,
          excludeSpotifyTrackIds: excludeIds,
          tracksPerArtist: 1 // reduce per-artist tracks to shrink response
        })
    )

    if (dbResult.tracks.length > 0) {
      logger(
        'INFO',
        `DB fallback returned ${dbResult.tracks.length} tracks for ${dbResult.uniqueArtistsAdded} unique artists`
      )

      dbFallbackStats.used = true
      dbFallbackStats.addedTracks = dbResult.tracks.length
      dbFallbackStats.addedArtists = dbResult.uniqueArtistsAdded
      dbFallbackStats.reason = 'artist_deficiency'
      dbFallbackStats.requestedTracks = neededArtists

      dbResult.tracks.forEach((track) => {
        // Use 'embedding' so DB fallback can be treated as a higher-priority, curated source
        registerCandidate(
          track,
          'embedding',
          candidateMap,
          playedTrackIds,
          currentArtistId
        )
      })

      uniqueArtists = countUniqueArtists(candidateMap)
      totalTracks = candidateMap.size

      logger(
        'INFO',
        `After DB fallback: ${totalTracks} tracks, ${uniqueArtists} unique artists`
      )
    } else {
      logger(
        'WARN',
        'DB fallback did not return any usable tracks. Proceeding with existing candidate pool.'
      )
    }
  }

  let finalPool = Array.from(candidateMap.values()).slice(0, MAX_CANDIDATE_POOL)
  uniqueArtists = countUniqueArtists(
    new Map(finalPool.map((c) => [c.track.id, c]))
  )

  logger(
    'INFO',
    `Final candidate pool: ${finalPool.length} tracks, ${uniqueArtists} unique artists | Filtering stats: checked=${filteringStats.totalChecked}, added=${filteringStats.added}, filtered: notPlayable=${filteringStats.filteredNotPlayable}, alreadyPlayed=${filteringStats.filteredAlreadyPlayed}, currentArtist=${filteringStats.filteredCurrentArtist}`
  )
  sourceDiversityTracker.logStatus('final_pool')

  // Removed: Last resort Spotify fetch loop (previously lines 960-1014)
  // Strategy changed to minimize Spotify API calls and rely on database fallback instead
  // If pool is insufficient, the absolute database fallback below will handle it

  // ABSOLUTE FALLBACK: If pool is STILL empty or lacks diversity, get ANY tracks from database
  // [FIX] Trigger even if we have *some* tracks but not enough unique artists
  if (
    finalPool.length < MIN_CANDIDATE_POOL ||
    uniqueArtists < DISPLAY_OPTION_COUNT * 2
  ) {
    logger(
      'WARN',
      `Candidate pool insufficient after all aggregation attempts (Pool=${finalPool.length}, Unique=${uniqueArtists}). Triggering ABSOLUTE FALLBACK.`
    )
    logger(
      'ERROR',
      `Candidate pool is empty after all aggregation attempts. Current track: ${currentTrackId}, Seed artist: ${seedArtistId}, Played tracks: ${playedTrackIds.length}, Related artists: ${relatedArtists.length}, Unique artists: ${uniqueArtists}, Filtering stats: ${JSON.stringify(filteringStats)}`
    )

    logger(
      'ERROR',
      'Pool empty after all strategies - using ABSOLUTE database fallback'
    )

    const excludeIds = new Set([currentTrackId, ...playedTrackIds])
    const neededTracks = MIN_CANDIDATE_POOL // Ensure we get at least MIN_CANDIDATE_POOL tracks
    const { fetchAbsoluteRandomTracks } = await import('./dgsDb')
    const absoluteFallback = await fetchAbsoluteRandomTracks(
      neededTracks,
      excludeIds
    )

    if (absoluteFallback.length > 0) {
      logger(
        'INFO',
        `Absolute fallback: Added ${absoluteFallback.length} random tracks (requested: ${neededTracks})`
      )
      absoluteFallback.forEach((track) => {
        registerCandidate(
          track,
          'embedding',
          candidateMap,
          playedTrackIds,
          currentArtistId
        )
      })
      finalPool = Array.from(candidateMap.values()).slice(0, MAX_CANDIDATE_POOL)

      // Update stats with detailed tracking
      dbFallbackStats.used = true
      dbFallbackStats.addedTracks = absoluteFallback.length
      dbFallbackStats.addedArtists = countUniqueArtists(
        new Map(finalPool.map((c) => [c.track.id, c]))
      )
      dbFallbackStats.reason = 'absolute_fallback'
      dbFallbackStats.requestedTracks = neededTracks
    } else {
      // Only throw if database is completely empty (should NEVER happen with 13,056 tracks)
      throw new Error(
        'Database has no tracks available - this should never occur'
      )
    }
  }

  // Warn if we don't have enough unique artists
  if (uniqueArtists < DISPLAY_OPTION_COUNT) {
    logger(
      'WARN',
      `Insufficient unique artists (${uniqueArtists}/${DISPLAY_OPTION_COUNT}). This may cause issues with diversity constraints.`
    )
  }

  // Ensure diversity balance in candidate pool
  finalPool = ensureDiversityBalance(finalPool)

  // Warn if pool is smaller than ideal but don't fail
  if (finalPool.length < MIN_CANDIDATE_POOL) {
    logger(
      'WARN',
      `Candidate pool (${finalPool.length}) is below required minimum (${MIN_CANDIDATE_POOL}). We have ${uniqueArtists} unique artists. Consider increasing tracksPerArtist or related artists count.`
    )
  }

  return {
    pool: finalPool,
    dbFallback: dbFallbackStats
  }

  function ensureDiversityBalance(
    candidates: CandidateSeed[]
  ): CandidateSeed[] {
    if (candidates.length === 0) return candidates

    logger(
      'INFO',
      `Checking diversity balance for ${candidates.length} candidates`,
      'ensureDiversityBalance'
    )

    // Map existing sources to diversity categories
    function mapSourceToDiversityCategory(
      source: CandidateSource
    ): keyof typeof DIVERSITY_SOURCES {
      switch (source) {
        case 'recommendations':
          return 'directRecommendations'
        case 'related_top_tracks':
          return 'relatedArtists'
        case 'target_insertion':
        case 'target_boost':
          return 'genreNeighbors'
        case 'embedding':
        default:
          return 'popularityVaried'
      }
    }

    // Count current distribution
    const currentDistribution = { ...DIVERSITY_SOURCES }
    Object.keys(currentDistribution).forEach((key) => {
      currentDistribution[key as keyof typeof DIVERSITY_SOURCES] = 0
    })

    candidates.forEach((candidate) => {
      const category = mapSourceToDiversityCategory(candidate.source)
      currentDistribution[category]++
    })

    // Calculate target counts
    const totalCandidates = candidates.length
    const targetCounts = Object.fromEntries(
      Object.entries(DIVERSITY_SOURCES).map(([key, percentage]) => [
        key,
        Math.round(totalCandidates * percentage)
      ])
    ) as Record<keyof typeof DIVERSITY_SOURCES, number>

    logger(
      'INFO',
      `Current distribution: ${Object.entries(currentDistribution)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')} | ` +
      `Target distribution: ${Object.entries(targetCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
      'ensureDiversityBalance'
    )

    // Check popularity band diversity
    const popularityBands = candidates.reduce(
      (acc, c) => {
        if (c.track.popularity !== undefined) {
          if (c.track.popularity < 33) acc.low++
          else if (c.track.popularity < 66) acc.mid++
          else acc.high++
        }
        return acc
      },
      { low: 0, mid: 0, high: 0 }
    )

    const totalWithPopularity =
      popularityBands.low + popularityBands.mid + popularityBands.high
    if (totalWithPopularity > 0) {
      const popularityDiversity =
        (popularityBands.low > 0 ? 1 : 0) +
        (popularityBands.mid > 0 ? 1 : 0) +
        (popularityBands.high > 0 ? 1 : 0)
      const diversityRatio = popularityDiversity / 3

      if (diversityRatio < 0.67) {
        // Less than 2/3 diversity
        logger(
          'WARN',
          `Low popularity diversity: ${popularityBands.low}/${popularityBands.mid}/${popularityBands.high} bands present (${(diversityRatio * 100).toFixed(1)}% coverage)`,
          'ensureDiversityBalance'
        )
      }
    }

    // For now, just log the diversity analysis
    // Future enhancement: could add candidates to underrepresented categories
    const underrepresentedCategories = Object.entries(currentDistribution)
      .filter(
        ([key, current]) =>
          current < targetCounts[key as keyof typeof targetCounts]
      )
      .map(
        ([key, current]) =>
          `${key}(${current}/${targetCounts[key as keyof typeof targetCounts]})`
      )

    if (underrepresentedCategories.length > 0) {
      logger(
        'INFO',
        `Diversity balance check: ${underrepresentedCategories.join(', ')} are underrepresented`,
        'ensureDiversityBalance'
      )
    } else {
      logger(
        'INFO',
        'Diversity balance check: All categories adequately represented',
        'ensureDiversityBalance'
      )
    }

    return candidates
  }
}

async function addRelatedArtistTracks({
  relatedArtists,
  token,
  candidateMap,
  playedTrackIds,
  currentArtistId,
  tracksPerArtist = 1,
  statisticsTracker,
  deadline
}: {
  relatedArtists: SpotifyArtist[]
  token: string
  candidateMap: Map<string, CandidateSeed>
  playedTrackIds: string[]
  currentArtistId: string
  tracksPerArtist?: number
  statisticsTracker?: ApiStatisticsTrackerType
  deadline?: number
}) {
  // 1. Collect all artist IDs
  const artistIds = relatedArtists.map((a) => a.id).filter(Boolean) as string[]

  if (artistIds.length === 0) return

  // Metrics are tracked by the musicService calls below

  // 2. Batch query database for all top tracks (FAST - single DB query)
  const dbTopTracks = await timeDbQuery(
    `batchGetTopTracksFromDb (${artistIds.length} artists)`,
    () => batchGetTopTracksFromDb(artistIds)
  )

  // 3. Identify which artists are missing from database
  const missingArtistIds = artistIds.filter((id) => !dbTopTracks.has(id))

  // Metrics are now tracked by the musicService calls

  // 4. ONLY fetch missing artists from Spotify (typically 0-5 artists after initial warm-up)
  // Use parallel batching to speed up fetching while respecting rate limits
  // LIMIT: Minimized to reduce Spotify API calls - database fallback will supplement
  if (missingArtistIds.length > 0) {
    // strict limit for cold starts
    const MAX_MISSING_TO_FETCH = 5 // Reduced from 8 to minimize API calls (single batch)
    const artistsToFetch = missingArtistIds.slice(0, MAX_MISSING_TO_FETCH)

    if (missingArtistIds.length > MAX_MISSING_TO_FETCH) {
      logger(
        'WARN',
        `Limiting top tracks fetch to ${MAX_MISSING_TO_FETCH}/${missingArtistIds.length} artists to minimize API calls. Database fallback will supplement.`,
        'addRelatedArtistTracks'
      )
    }

    logger(
      'INFO',
      `Fetching top tracks from Spotify for ${artistsToFetch.length} artists not in DB cache`
    )

    const PARALLEL_BATCH_SIZE = 5 // Reduced from 15 to minimize concurrent API calls

    // Process in batches to avoid rate limits
    // Check deadline before starting batches
    if (deadline && Date.now() > deadline) {
      logger(
        'WARN',
        'Skipping Spotify fetch in addRelatedArtistTracks due to deadline',
        'addRelatedArtistTracks'
      )
      return
    }

    for (let i = 0; i < artistsToFetch.length; i += PARALLEL_BATCH_SIZE) {
      // Check deadline before next batch
      if (deadline && Date.now() > deadline) {
        logger(
          'WARN',
          'Stopping Spotify fetch batches due to deadline',
          'addRelatedArtistTracks'
        )
        break
      }
      const batch = artistsToFetch.slice(i, i + PARALLEL_BATCH_SIZE)

      await Promise.all(
        batch.map(async (artistId) => {
          try {
            const tracks = await timeApiCall(
              `getArtistTopTracksServer (${artistId})`,
              () => getArtistTopTracksServer(artistId, token, statisticsTracker)
            )

            // Queue database cache updates (non-blocking)
            void enqueueLazyUpdate({
              type: 'artist_top_tracks',
              spotifyId: artistId,
              payload: { trackIds: tracks.map((t) => t.id) }
            })
            void enqueueLazyUpdate({
              type: 'track_details',
              spotifyId: artistId,
              payload: { tracks }
            })

            // Add to local map
            dbTopTracks.set(artistId, tracks)
          } catch (error) {
            logger(
              'WARN',
              `Failed to fetch top tracks for artist ${artistId}`,
              'addRelatedArtistTracks',
              error instanceof Error ? error : undefined
            )
          }
        })
      )

      logger(
        'INFO',
        `Completed batch ${Math.floor(i / PARALLEL_BATCH_SIZE) + 1}/${Math.ceil(artistsToFetch.length / PARALLEL_BATCH_SIZE)} (${batch.length} artists)`
      )
    }
  } else {
    logger(
      'INFO',
      `All ${artistIds.length} artists found in DB cache - no Spotify API calls needed!`
    )
  }

  // 5. Use the combined data (mostly from database)
  dbTopTracks.forEach((tracks, artistId) => {
    tracks
      .slice(0, tracksPerArtist)
      .forEach((track) =>
        registerCandidate(
          track,
          'related_top_tracks',
          candidateMap,
          playedTrackIds,
          currentArtistId
        )
      )
  })
}

// Recommendations endpoint is deprecated - removed addRecommendationTracks and addEmbeddingTracks
// All candidate generation now uses related artists and their top tracks

// Track filtering statistics for debugging
let filteringStats = {
  totalChecked: 0,
  filteredNotPlayable: 0,
  filteredAlreadyPlayed: 0,
  filteredCurrentArtist: 0,
  added: 0
}

function registerCandidate(
  track: TrackDetails | undefined,
  source: CandidateSource,
  candidateMap: Map<string, CandidateSeed>,
  playedTrackIds: string[],
  currentArtistId: string
) {
  filteringStats.totalChecked++

  if (!track?.id || !track.is_playable) {
    filteringStats.filteredNotPlayable++
    return
  }
  if (playedTrackIds.includes(track.id)) {
    filteringStats.filteredAlreadyPlayed++
    return
  }

  // Exclude tracks by the currently playing artist
  const trackArtistId = track.artists?.[0]?.id
  if (trackArtistId && trackArtistId === currentArtistId) {
    filteringStats.filteredCurrentArtist++
    return
  }

  const existing = candidateMap.get(track.id)
  if (!existing || sourcePriority(source) < sourcePriority(existing.source)) {
    candidateMap.set(track.id, { track, source })
    filteringStats.added++
  }
}

function resetFilteringStats() {
  filteringStats = {
    totalChecked: 0,
    filteredNotPlayable: 0,
    filteredAlreadyPlayed: 0,
    filteredCurrentArtist: 0,
    added: 0
  }
}

/**
 * Counts unique artists in the candidate pool
 */
function countUniqueArtists(candidateMap: Map<string, CandidateSeed>): number {
  const artistIds = new Set<string>()
  for (const candidate of Array.from(candidateMap.values())) {
    const artistId = candidate.track.artists?.[0]?.id
    if (artistId) {
      artistIds.add(artistId)
    }
  }
  return artistIds.size
}

function sourcePriority(source: CandidateSource): number {
  switch (source) {
    case 'target_insertion':
      return 0
    case 'embedding':
      return 1
    case 'recommendations':
      return 2
    case 'related_top_tracks':
    default:
      return 3
  }
}

/**
 * Enrich candidates with artist profiles by lazily fetching missing ones
 * This ensures DB fallback tracks have artist data for attraction calculations
 * Handles both artist IDs and artist names (for DB tracks without Spotify IDs)
 */
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

  // For artists without IDs, search by name and cache the result
  if (artistsWithoutIds.length > 0) {
    logger(
      'INFO',
      `Enriching ${artistsWithoutIds.length} artists by name search...`,
      'enrichCandidatesWithArtistProfiles'
    )

    let nameSearchCount = 0
    const limitedSearches = artistsWithoutIds.slice(0, 20) // Limit to avoid too many API calls
    for (const artistInfo of limitedSearches) {
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
              `Resolved artist ID for "${artistInfo.artistObj.name}": ${artistInfo.artistObj.id} -> ${match.id}`,
              'enrichCandidatesWithArtistProfiles'
            )
            artistInfo.artistObj.id = match.id
          }

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

    // Detailed logging for target artist search debugging
    const searchQuery = encodeURIComponent(artist.name)
    logger(
      'INFO',
      `[TARGET SEARCH] Searching Spotify for: "${artist.name}" | Encoded query: "${searchQuery}"`,
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

export function extractTrackMetadata(
  track: TrackDetails,
  artistProfile: ArtistProfile | undefined
): TrackMetadata {
  return {
    popularity: track.popularity ?? 50,
    duration_ms: track.duration_ms ?? 180000,
    release_date: track.album?.release_date,
    genres: artistProfile?.genres ?? [],
    artistId: track.artists?.[0]?.id
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
  )

  logger(
    'INFO',
    `Baseline attraction (current song to ${currentPlayerId} target): ${(currentSongAttraction ?? 0).toFixed(3)}`,
    'scoreCandidates'
  )

  // [STRICT COMPLIANCE] Fallback Injection to ensure unique artists
  // If we have fewer than 20 unique artists, fetch distinct ones from DB
  const uniqueArtistNames = new Set<string>()
  candidates.forEach((c) => {
    if (c.track.artists?.[0]?.name) {
      uniqueArtistNames.add(normalizeName(c.track.artists[0].name))
    }
  })

  // Buffer of 20 unique artists to safely select 9 without duplicates
  // This replaces the previous "Desperation Mode" with a proper data fill
  const MIN_STRICT_UNIQUE_ARTISTS = 20
  if (uniqueArtistNames.size < MIN_STRICT_UNIQUE_ARTISTS && allowFallback) {
    logger(
      'WARN',
      `Unique artist deficit (${uniqueArtistNames.size} < ${MIN_STRICT_UNIQUE_ARTISTS}). Fetching fallback tracks for strict compliance.`,
      'scoreCandidates'
    )

    const needed = MIN_STRICT_UNIQUE_ARTISTS - uniqueArtistNames.size
    const existingTrackIds = new Set(candidates.map((c) => c.track.id))

    // Blocking call to ensure we have data before scoring
    const fallbackResult = await fetchRandomTracksFromDb({
      neededArtists: needed,
      existingArtistNames: uniqueArtistNames, // Pass names to ignore artists we already have
      excludeSpotifyTrackIds: existingTrackIds,
      tracksPerArtist: 1 // Only 1 track per new artist to maximize diversity
    })

    if (fallbackResult.tracks.length > 0) {
      logger(
        'INFO',
        `Fallback fetched ${fallbackResult.tracks.length} tracks from ${fallbackResult.uniqueArtistsAdded} unique artists`,
        'scoreCandidates'
      )
      fallbackResult.tracks.forEach((track) => {
        candidates.push({
          track: track,
          source: 'recommendations' // Generic source
        })
      })
    } else {
      logger(
        'WARN',
        'Fallback failed to return any usage tracks.',
        'scoreCandidates'
      )
    }
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

      // 2. Missing Artist Metadata (Pop/Followers)
      // We check artistProfile because that's what we use for scoring
      if (
        artistProfile &&
        (artistProfile.followers === undefined ||
          artistProfile.popularity === undefined)
      ) {
        logger(
          'INFO',
          `[Lazy Backfill] Missing artist metadata for "${artistProfile.name}" (pop: ${artistProfile.popularity}, followers: ${artistProfile.followers}) - triggering backfill`,
          'scoreCandidates'
        )
        void safeBackfillArtistGenres(
          artistProfile.id,
          artistProfile.name,
          token
        )
      }
    }

    const { score: simScore, components: scoreComponents } = computeSimilarity(
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

    const aAttractionVal = computeAttraction(
      artistProfile,
      targetProfiles.player1,
      artistProfiles,
      artistRelationships
    )
    const bAttraction = computeAttraction(
      artistProfile,
      targetProfiles.player2,
      artistProfiles,
      artistRelationships
    )

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

  // Summary statistics
  const calcStats = (scores: number[]) => {
    if (scores.length === 0) return { min: 0, max: 0, avg: 0, median: 0 }
    const sorted = [...scores].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    const median = sorted[Math.floor(sorted.length / 2)]
    return { min, max, avg, median }
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
      totalCandidates: metrics.length, // Added missing field
      p1NonZeroAttraction: attractionStats.p1NonZero,
      p2NonZeroAttraction: attractionStats.p2NonZero,
      zeroAttractionReasons,
      candidates: candidateDebugInfo
    }
  }
}

interface TrackMetadata {
  popularity: number
  duration_ms: number
  release_date?: string
  genres: string[]
  artistId?: string
}

function computeSimilarity(
  baseTrack: TrackDetails,
  baseMetadata: TrackMetadata,
  candidateTrack: TrackDetails,
  candidateMetadata: TrackMetadata,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): { score: number; components: ScoringComponents } {
  // Genre similarity (25% weight)
  // Use weighted genre graph instead of simple Jaccard index
  const genreSimilarity = calculateAvgMaxGenreSimilarity(
    baseMetadata.genres,
    candidateMetadata.genres
  )

  // Track popularity proximity (15% weight) - reduced from 20%
  const popularityDiff = Math.abs(
    baseMetadata.popularity - candidateMetadata.popularity
  )
  const trackPopularitySimilarity = Math.max(0, 1 - popularityDiff / 100)

  // Artist relationship depth (20% weight) - increased from 15%, now checks DB
  const artistRelationshipScore = computeArtistRelationshipScore(
    baseMetadata.artistId,
    candidateMetadata.artistId,
    artistProfiles,
    artistRelationships
  )

  // Artist popularity similarity (15% weight) - NEW
  const artistPopularitySimilarity = computeArtistPopularitySimilarity(
    baseMetadata.artistId,
    candidateMetadata.artistId,
    artistProfiles
  )

  // Release era proximity (15% weight) - increased from 10%
  const releaseSimilarity = computeReleaseEraSimilarity(
    baseMetadata.release_date,
    candidateMetadata.release_date
  )

  // Follower similarity (10% weight) - NEW
  const baseProfile = baseMetadata.artistId
    ? artistProfiles.get(baseMetadata.artistId)
    : undefined
  const candidateProfile = candidateMetadata.artistId
    ? artistProfiles.get(candidateMetadata.artistId)
    : undefined
  const followerSimilarity = computeFollowerSimilarity(
    baseProfile?.followers,
    candidateProfile?.followers
  )

  // Weighted combination (duration similarity removed)
  const combinedScore =
    0.5 * genreSimilarity.score + // Boosted: 30% -> 50% (User Request)
    0.1 * artistRelationshipScore + // Reduced: 30% -> 10% (User Request)
    0.075 * trackPopularitySimilarity + // Reduced: 10% -> 7.5%
    0.075 * artistPopularitySimilarity + // Reduced: 10% -> 7.5%
    0.2 * releaseSimilarity + // Boosted & Swapped: 5% -> 20% (User Request)
    0.05 * followerSimilarity // Reduced & Swapped: 20% -> 5% (User Request)

  const finalScore = Math.max(0, Math.min(1, combinedScore))

  const baseTrackName = baseTrack.name ?? 'Unknown'
  const candidateTrackName = candidateTrack.name ?? 'Unknown'
  logger(
    'INFO',
    `Similarity: ${baseTrackName} vs ${candidateTrackName} | Genre(50%)=${genreSimilarity.score.toFixed(3)} | Relationship(10%)=${artistRelationshipScore.toFixed(3)} | TrackPop(7.5%)=${trackPopularitySimilarity.toFixed(3)} | ArtistPop(7.5%)=${artistPopularitySimilarity.toFixed(3)} | Era(20%)=${releaseSimilarity.toFixed(3)} | Followers(5%)=${followerSimilarity.toFixed(3)} | Final=${finalScore.toFixed(3)}`,
    'computeSimilarity'
  )

  return {
    score: finalScore,
    components: {
      genre: genreSimilarity,
      relationship: artistRelationshipScore,
      trackPop: trackPopularitySimilarity,
      artistPop: artistPopularitySimilarity,
      era: releaseSimilarity,
      followers: followerSimilarity
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

function computeArtistPopularitySimilarity(
  baseArtistId: string | undefined,
  candidateArtistId: string | undefined,
  artistProfiles: Map<string, ArtistProfile>
): number {
  // If either artist is missing or no popularity data, return neutral
  if (!baseArtistId || !candidateArtistId) {
    return 0.5
  }

  const baseProfile = artistProfiles.get(baseArtistId)
  const candidateProfile = artistProfiles.get(candidateArtistId)

  if (!baseProfile || !candidateProfile) {
    return 0.5
  }

  const basePop = baseProfile.popularity ?? 50
  const candidatePop = candidateProfile.popularity ?? 50

  // Similarity based on popularity difference (0-100 scale)
  const popularityDiff = Math.abs(basePop - candidatePop)
  return Math.max(0, 1 - popularityDiff / 100)
}

function computeReleaseEraSimilarity(
  releaseDate1?: string,
  releaseDate2?: string
): number {
  if (!releaseDate1 || !releaseDate2) {
    return 0.5 // Neutral if missing
  }

  try {
    // Parse dates (format: YYYY-MM-DD or YYYY-MM or YYYY)
    const year1 = parseInt(releaseDate1.substring(0, 4), 10)
    const year2 = parseInt(releaseDate2.substring(0, 4), 10)

    if (isNaN(year1) || isNaN(year2)) {
      return 0.5
    }

    const yearDiff = Math.abs(year1 - year2)
    // Similar if within 5 years, decreasing after that
    const maxDiff = 30 // 30 years max difference
    return Math.max(0, 1 - yearDiff / maxDiff)
  } catch {
    return 0.5
  }
}

/**
 * Compute similarity strictly between two artists
 * Ignores track-level metadata like release date or track popularity
 * Used for "Attraction" calculation (Target-to-Candidate proximity)
 */
function computeStrictArtistSimilarity(
  baseProfile: ArtistProfile,
  candidateProfile: ArtistProfile,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): { score: number; components: ScoringComponents } {
  // 1. Identity Check (Mathematical Truth, not a hack)
  if (baseProfile.id === candidateProfile.id) {
    return {
      score: 1.0,
      components: {
        genre: { score: 1.0, details: [] },
        relationship: 1.0,
        trackPop: 1.0,
        artistPop: 1.0,
        era: 1.0,
        followers: 1.0
      }
    }
  }

  // 2. Genre Similarity (40%)
  const genreSimilarity = calculateAvgMaxGenreSimilarity(
    baseProfile.genres,
    candidateProfile.genres
  )

  // 3. Relationship (30%)
  const relationshipScore = computeArtistRelationshipScore(
    baseProfile.id,
    candidateProfile.id,
    artistProfiles,
    artistRelationships
  )

  // 4. Artist Popularity (15%)
  const artistPopSim = computeArtistPopularitySimilarity(
    baseProfile.id,
    candidateProfile.id,
    artistProfiles
  )

  // 5. Follower Similarity (15%)
  const followerSim = computeFollowerSimilarity(
    baseProfile.followers,
    candidateProfile.followers
  )

  // Weighted Score
  const score =
    genreSimilarity.score * 0.4 +
    relationshipScore * 0.3 +
    artistPopSim * 0.15 +
    followerSim * 0.15

  return {
    score,
    components: {
      genre: genreSimilarity,
      relationship: relationshipScore,
      trackPop: 0,
      artistPop: artistPopSim,
      era: 0,
      followers: followerSim
    }
  }
}

export function computeAttraction(
  artistProfile: ArtistProfile | undefined,
  targetProfile: TargetProfile | null,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): number {
  if (!artistProfile) {
    logger(
      'WARN',
      `computeAttraction: artistProfile is undefined`,
      'computeAttraction'
    )
    return 0
  }
  if (!targetProfile) {
    logger(
      'WARN',
      `computeAttraction: targetProfile is null (artist: ${artistProfile.name})`,
      'computeAttraction'
    )
    return 0
  }

  // Convert TargetProfile to ArtistProfile interface for comparison
  const targetArtistProfile: ArtistProfile = {
    id: targetProfile.spotifyId || targetProfile.artist.id || '',
    name: targetProfile.artist.name,
    genres: targetProfile.genres,
    popularity: targetProfile.popularity,
    followers: targetProfile.followers
  }

  // Calculate strict artist-to-artist similarity
  const { score } = computeStrictArtistSimilarity(
    targetArtistProfile,
    artistProfile,
    artistProfiles,
    artistRelationships
  )

  logger(
    'INFO',
    `Attraction: ${artistProfile.name} -> ${targetProfile.artist.name} = ${(score ?? 0).toFixed(3)}`,
    'computeAttraction'
  )
  return score ?? 0
}

/**
 * Calculate similarity based on popularity scores (0-100)
 * Returns 0.0 to 1.0, where 1.0 = identical popularity
 */
function computePopularitySimilarity(
  popularity1: number | undefined,
  popularity2: number | undefined
): number {
  if (popularity1 === undefined || popularity2 === undefined) {
    return 0.5 // Neutral when data missing
  }
  const difference = Math.abs(popularity1 - popularity2)
  return 1 - difference / 100
}

/**
 * Calculate similarity based on follower counts using logarithmic scale
 * Returns 0.0 to 1.0, where 1.0 = similar fanbase size
 */
function computeFollowerSimilarity(
  followers1: number | undefined,
  followers2: number | undefined
): number {
  if (!followers1 || !followers2) {
    return 0.5 // Neutral when data missing
  }

  // Use log10 to handle wide range of follower counts (1K to 100M+)
  const log1 = Math.log10(Math.max(followers1, 1))
  const log2 = Math.log10(Math.max(followers2, 1))
  const logDiff = Math.abs(log1 - log2)

  // logDiff of 3 = 1000x difference (e.g., 1K vs 1M)
  // Normalize to 0-1 range
  return 1 - Math.min(logDiff / 3, 1)
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function getPopularityBand(popularity: number): PopularityBand {
  if (popularity < 34) return 'low'
  if (popularity < 67) return 'mid'
  return 'high'
}

export function applyDiversityConstraints(
  metrics: CandidateTrackMetrics[],
  roundNumber: number,
  targetProfiles: Record<PlayerId, TargetProfile | null>,
  playerGravities: PlayerGravityMap,
  currentPlayerId: PlayerId,
  forceHardConvergence?: boolean
): {
  selected: CandidateTrackMetrics[]
  filteredArtistNames: Set<string>
} {
  const artistIds = new Set<string>()
  const selected: CandidateTrackMetrics[] = []
  const hardConvergenceActive =
    forceHardConvergence ?? roundNumber >= MAX_ROUND_TURNS
  const SIMILARITY_THRESHOLD = 0.4

  logger(
    'INFO',
    `Applying diversity constraints: Round=${roundNumber} | Threshold=${SIMILARITY_THRESHOLD} | HardConvergence=${hardConvergenceActive} | InputCandidates=${metrics.length}`,
    'applyDiversityConstraints'
  )

  // Track which artists were filtered
  const filteredArtistNames = new Set<string>()

  // Filter out target artists in early rounds unless they're actually related
  const filteredMetrics = metrics.filter((metric) => {
    // In round 10+, allow all target artists naturally
    if (hardConvergenceActive) {
      return true
    }

    // Check if this candidate is a target artist
    const candidateArtistName = normalizeName(metric.artistName ?? '')
    const isTargetArtist = Object.values(targetProfiles).some((target) => {
      if (!target) return false
      return normalizeName(target.artist.name) === candidateArtistName
    })

    // If not a target artist, allow it
    if (!isTargetArtist) {
      return true
    }

    // If it's a target artist in early rounds, only allow if similarity is high (actually related)
    const allowed = metric.simScore > SIMILARITY_THRESHOLD
    if (!allowed) {
      filteredArtistNames.add(metric.artistName ?? 'Unknown')
      logger(
        'INFO',
        `Filtered target artist: ${metric.artistName} (Sim=${metric.simScore.toFixed(3)} < ${SIMILARITY_THRESHOLD})`,
        'applyDiversityConstraints'
      )
    } else {
      logger(
        'INFO',
        `Allowed target artist: ${metric.artistName} (Sim=${metric.simScore.toFixed(3)} >= ${SIMILARITY_THRESHOLD})`,
        'applyDiversityConstraints'
      )
    }
    return allowed
  })

  const filteredCount = metrics.length - filteredMetrics.length
  if (filteredCount > 0) {
    logger(
      'INFO',
      `Filtered ${filteredCount} target artists in early rounds (${filteredMetrics.length} remaining)`,
      'applyDiversityConstraints'
    )
  }

  // Sort by finalScore descending to ensure we select the best candidates
  const sortedFilteredMetrics = [...filteredMetrics].sort(
    (a, b) => b.finalScore - a.finalScore
  )

  // Get the appropriate attraction value based on current player
  const getCurrentPlayerAttraction = (
    metric: CandidateTrackMetrics
  ): number => {
    return currentPlayerId === 'player1'
      ? metric.aAttraction
      : metric.bAttraction
  }

  // Calculate differences from baseline for all candidates
  const candidatesWithDiff = sortedFilteredMetrics.map((m) => ({
    metric: m,
    diff: getCurrentPlayerAttraction(m) - m.currentSongAttraction,
    attraction: getCurrentPlayerAttraction(m),
    baseline: m.currentSongAttraction
  }))

  // Sort by difference (positive = closer, negative = further)
  candidatesWithDiff.sort((a, b) => b.diff - a.diff)

  // Calculate baseline early - it's the same for all candidates
  const baseline = candidatesWithDiff[0]?.metric.currentSongAttraction ?? 0

  // Define tolerance for "neutral" - options within this margin are considered neutral
  // Increased from 0.01 to 0.02 (2%) to create a wider neutral zone for better gameplay
  // This prevents tracks that are barely different from baseline from being categorized as FURTHER
  const NEUTRAL_TOLERANCE = 0.02 // 2% tolerance for neutral zone

  // Calculate the actual range of differences to better understand distribution
  const diffs = candidatesWithDiff.map((item) => item.diff)
  const minDiff = Math.min(...diffs)
  const maxDiff = Math.max(...diffs)
  const diffRange = maxDiff - minDiff

  // Use adaptive tolerance based on actual distribution
  // If differences are very small (tightly clustered), use a smaller tolerance
  // If differences are large, use the standard tolerance
  const adaptiveTolerance =
    diffRange < 0.1
      ? Math.max(0.015, diffRange * 0.2) // 20% of range, min 0.015
      : NEUTRAL_TOLERANCE

  logger(
    'INFO',
    `Difference range: ${minDiff.toFixed(3)} to ${maxDiff.toFixed(3)} (range=${diffRange.toFixed(3)}), using tolerance=${adaptiveTolerance.toFixed(3)}`,
    'applyDiversityConstraints'
  )

  // Calculate quality scores for category validation
  function calculateCategoryQuality(
    candidates: CandidateTrackMetrics[],
    baseline: number,
    currentPlayerId: 'player1' | 'player2'
  ): CategoryQuality {
    if (candidates.length === 0) {
      return {
        averageAttractionDelta: 0,
        diversityScore: 0,
        popularitySpread: 0,
        genreVariety: 0,
        qualityScore: 0
      }
    }

    // Average attraction delta from baseline
    const attractionDeltas = candidates.map((c) => {
      const currentPlayerAttraction =
        currentPlayerId === 'player1' ? c.aAttraction : c.bAttraction
      return currentPlayerAttraction - baseline
    })
    const averageAttractionDelta =
      attractionDeltas.reduce((a, b) => a + b, 0) / attractionDeltas.length

    // Artist diversity (unique artists / total tracks)
    const uniqueArtists = new Set(
      candidates.map((c) => c.artistId).filter(Boolean)
    )
    const diversityScore = uniqueArtists.size / candidates.length

    // Popularity spread (presence of low/mid/high bands)
    const popularityBands = candidates.reduce(
      (acc, c) => {
        acc[c.popularityBand] = (acc[c.popularityBand] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
    const bandPresence =
      (popularityBands.low ? 1 : 0) +
      (popularityBands.mid ? 1 : 0) +
      (popularityBands.high ? 1 : 0)
    const popularitySpread = bandPresence / 3

    // Genre variety (unique genres / total tracks)
    const allGenres = new Set<string>()
    candidates.forEach((c) => {
      if (c.artistGenres) {
        c.artistGenres.forEach((genre) => allGenres.add(genre))
      }
    })
    const genreVariety = allGenres.size / candidates.length

    // Overall quality score (weighted average)
    const qualityScore =
      Math.abs(averageAttractionDelta) * 0.4 + // Attraction strength
      diversityScore * 0.3 + // Artist diversity
      popularitySpread * 0.15 + // Popularity variety
      genreVariety * 0.15 // Genre variety

    return {
      averageAttractionDelta,
      diversityScore,
      popularitySpread,
      genreVariety,
      qualityScore
    }
  }

  // First, identify candidates that are actually closer/further/neutral
  const actuallyCloser = candidatesWithDiff
    .filter((item) => item.diff > adaptiveTolerance)
    .map((item) => item.metric)

  const actuallyFurther = candidatesWithDiff
    .filter((item) => item.diff < -adaptiveTolerance)
    .map((item) => item.metric)

  const actuallyNeutral = candidatesWithDiff
    .filter((item) => Math.abs(item.diff) <= adaptiveTolerance)
    .map((item) => item.metric)

  // Goal: Get 3 from each category
  // Strategy: Use actual closer/further first, then use percentile-based selection from remaining
  const TARGET_PER_CATEGORY = 3

  // Use percentile-based approach to ensure we get 3 from each category
  // Split into thirds based on difference from baseline
  const totalCandidates = candidatesWithDiff.length
  const thirdSize = Math.max(
    TARGET_PER_CATEGORY,
    Math.floor(totalCandidates / 3)
  )

  // Top third = closer (positive differences, sorted descending)
  // Use adaptive tolerance for filtering
  const topThird = candidatesWithDiff
    .filter((item) => item.diff > adaptiveTolerance)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, thirdSize)
    .map((item) => item.metric)

  // Bottom third = further (negative differences, sorted ascending)
  const bottomThird = candidatesWithDiff
    .filter((item) => item.diff < -adaptiveTolerance)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, thirdSize)
    .map((item) => item.metric)

  // Middle = neutral (within tolerance of baseline)
  const middleThird = candidatesWithDiff
    .filter((item) => Math.abs(item.diff) <= adaptiveTolerance)
    .map((item) => item.metric)

  // If we don't have enough in a category, expand from adjacent categories
  const goodCandidates: CandidateTrackMetrics[] = [...topThird]
  const badCandidates: CandidateTrackMetrics[] = [...bottomThird]
  let neutralCandidates: CandidateTrackMetrics[] = [...middleThird]

  // Ensure we have at least TARGET_PER_CATEGORY in each
  // Use percentile-based approach when categories are insufficient
  // Special handling: If all differences are negative (all candidates are "further"),
  // the top third (least negative) should still be treated as "closer" for gameplay
  if (goodCandidates.length < TARGET_PER_CATEGORY) {
    // Check quality of current closer candidates before expanding
    const closerQuality = calculateCategoryQuality(
      goodCandidates,
      baseline,
      currentPlayerId
    )
    const minQualityThreshold = MIN_QUALITY_THRESHOLDS.closer

    if (closerQuality.qualityScore < minQualityThreshold) {
      logger(
        'WARN',
        `Closer category quality (${closerQuality.qualityScore.toFixed(3)}) below threshold (${minQualityThreshold}). Current: delta=${closerQuality.averageAttractionDelta.toFixed(3)}, diversity=${closerQuality.diversityScore.toFixed(3)}, popularity=${closerQuality.popularitySpread.toFixed(3)}, genres=${closerQuality.genreVariety.toFixed(3)}`,
        'applyDiversityConstraints'
      )
    }

    // If we don't have enough genuine "closer" tracks, use percentile approach
    // Take top third of all candidates by difference (best relative to baseline)
    // When all differences are negative, this gives us the "least further" options
    const percentileCloser = candidatesWithDiff
      .sort((a, b) => b.diff - a.diff) // Sort by diff descending (best first)
      .slice(0, Math.max(thirdSize, TARGET_PER_CATEGORY * 2))
      .filter((item) => !goodCandidates.includes(item.metric))
      .slice(0, TARGET_PER_CATEGORY * 2 - goodCandidates.length)
      .map((item) => item.metric)

    goodCandidates.push(...percentileCloser)

    // Check quality after expansion
    const expandedCloserQuality = calculateCategoryQuality(
      goodCandidates,
      baseline,
      currentPlayerId
    )
    const qualityImproved =
      expandedCloserQuality.qualityScore > closerQuality.qualityScore

    // Check if all differences are negative for logging
    const allNegative = maxDiff <= 0
    if (allNegative) {
      logger(
        'WARN',
        `All candidates are "further" (max diff=${maxDiff.toFixed(3)}). Using top third as "closer" for gameplay balance. Expanded closer category: ${goodCandidates.length} candidates (added ${percentileCloser.length} via percentile). Quality: ${expandedCloserQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
        'applyDiversityConstraints'
      )
    } else {
      logger(
        'INFO',
        `Expanded closer category: ${goodCandidates.length} candidates (added ${percentileCloser.length} via percentile). Quality: ${expandedCloserQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
        'applyDiversityConstraints'
      )
    }
  }

  if (badCandidates.length < TARGET_PER_CATEGORY) {
    // Check quality of current further candidates before expanding
    const furtherQuality = calculateCategoryQuality(
      badCandidates,
      baseline,
      currentPlayerId
    )
    const minQualityThreshold = MIN_QUALITY_THRESHOLDS.further

    if (
      Math.abs(furtherQuality.averageAttractionDelta) <
      Math.abs(minQualityThreshold)
    ) {
      logger(
        'WARN',
        `Further category quality (${furtherQuality.qualityScore.toFixed(3)}) below threshold (${minQualityThreshold}). Current: delta=${furtherQuality.averageAttractionDelta.toFixed(3)}, diversity=${furtherQuality.diversityScore.toFixed(3)}, popularity=${furtherQuality.popularitySpread.toFixed(3)}, genres=${furtherQuality.genreVariety.toFixed(3)}`,
        'applyDiversityConstraints'
      )
    }

    // If we don't have enough genuine "further" tracks, use percentile approach
    // Take bottom third of all candidates by difference (worst relative to baseline)
    const percentileFurther = candidatesWithDiff
      .sort((a, b) => a.diff - b.diff)
      .slice(0, Math.max(thirdSize, TARGET_PER_CATEGORY * 2))
      .filter((item) => !badCandidates.includes(item.metric))
      .slice(0, TARGET_PER_CATEGORY * 2 - badCandidates.length)
      .map((item) => item.metric)

    badCandidates.push(...percentileFurther)

    // Check quality after expansion
    const expandedFurtherQuality = calculateCategoryQuality(
      badCandidates,
      baseline,
      currentPlayerId
    )
    const qualityImproved =
      expandedFurtherQuality.qualityScore > furtherQuality.qualityScore

    logger(
      'INFO',
      `Expanded further category: ${badCandidates.length} candidates (added ${percentileFurther.length} via percentile). Quality: ${expandedFurtherQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
      'applyDiversityConstraints'
    )
  }

  // If neutral is still too small, use percentile approach
  if (neutralCandidates.length < TARGET_PER_CATEGORY) {
    // Check quality of current neutral candidates before expanding
    const neutralQuality = calculateCategoryQuality(
      neutralCandidates,
      baseline,
      currentPlayerId
    )
    const minQualityThreshold = MIN_QUALITY_THRESHOLDS.neutral

    if (neutralQuality.qualityScore < minQualityThreshold) {
      logger(
        'WARN',
        `Neutral category quality (${neutralQuality.qualityScore.toFixed(3)}) below threshold (${minQualityThreshold}). Current: delta=${neutralQuality.averageAttractionDelta.toFixed(3)}, diversity=${neutralQuality.diversityScore.toFixed(3)}, popularity=${neutralQuality.popularitySpread.toFixed(3)}, genres=${neutralQuality.genreVariety.toFixed(3)}`,
        'applyDiversityConstraints'
      )
    }

    const used = new Set([...goodCandidates, ...badCandidates])
    const remaining = candidatesWithDiff
      .filter((item) => !used.has(item.metric))
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff)) // Closest to baseline first
      .slice(0, Math.max(TARGET_PER_CATEGORY, thirdSize))
      .map((item) => item.metric)
    neutralCandidates = [...neutralCandidates, ...remaining].slice(0, thirdSize)

    // Check quality after expansion
    const expandedNeutralQuality = calculateCategoryQuality(
      neutralCandidates,
      baseline,
      currentPlayerId
    )
    const qualityImproved =
      expandedNeutralQuality.qualityScore > neutralQuality.qualityScore

    logger(
      'INFO',
      `Expanded neutral category: ${neutralCandidates.length} candidates. Quality: ${expandedNeutralQuality.qualityScore.toFixed(3)} (${qualityImproved ? 'improved' : 'degraded'})`,
      'applyDiversityConstraints'
    )
  }

  // Log attraction distribution for diagnostics
  const attractionScores = candidatesWithDiff.map((item) => item.attraction)
  const attractionStats =
    attractionScores.length > 0
      ? {
        min: Math.min(...attractionScores),
        max: Math.max(...attractionScores),
        avg:
          attractionScores.reduce((a, b) => a + b, 0) /
          attractionScores.length,
        median: attractionScores.sort((a, b) => a - b)[
          Math.floor(attractionScores.length / 2)
        ]
      }
      : { min: 0, max: 0, avg: 0, median: 0 }
  const diffStats = {
    min: minDiff,
    max: maxDiff,
    avg:
      candidatesWithDiff.reduce((sum, item) => sum + item.diff, 0) /
      candidatesWithDiff.length
  }

  // Check if all differences are on one side (all positive or all negative)
  // This requires percentile-based redistribution to create a balanced mix
  const allNegative = maxDiff <= 0 // All differences are negative (all "further")
  const allPositive = minDiff > 0 // All differences are positive (all "closer") - needs percentile split

  logger(
    'INFO',
    `Attraction distribution (baseline=${baseline.toFixed(3)}, total=${totalCandidates}): ` +
    `Attraction: min=${attractionStats.min.toFixed(3)}, max=${attractionStats.max.toFixed(3)}, avg=${attractionStats.avg.toFixed(3)}, median=${attractionStats.median.toFixed(3)} | ` +
    `Diff: min=${diffStats.min.toFixed(3)}, max=${diffStats.max.toFixed(3)}, avg=${diffStats.avg.toFixed(3)}, range=${diffRange.toFixed(3)}${allNegative ? ' | ⚠️ ALL NEGATIVE (no genuine closer options)' : ''}${allPositive ? ' | ⚠️ ALL POSITIVE (no genuine further options)' : ''}`,
    'applyDiversityConstraints'
  )

  logger(
    'INFO',
    `Strategic categories for Player ${currentPlayerId}: Closer=${goodCandidates.length} | Neutral=${neutralCandidates.length} | Further=${badCandidates.length}${allNegative || allPositive ? ' (using percentile-based relative categorization)' : ''}`,
    'applyDiversityConstraints'
  )

  // Define similarity tiers for diversity within each category
  const SIMILARITY_TIERS = {
    low: { min: 0, max: 0.4, label: 'low' as const },
    medium: { min: 0.4, max: 0.7, label: 'medium' as const },
    high: { min: 0.7, max: 1.0, label: 'high' as const }
  }

  // Track artist names separately for name-based duplicate detection
  const artistNames = new Set<string>()

  // Helper function to check if an artist is already selected
  const isArtistSelected = (metric: CandidateTrackMetrics): boolean => {
    const trackArtistIds = new Set<string>()
    const trackArtistNames = new Set<string>()

    // Add primary artist ID
    const primaryArtistId = metric.artistId ?? metric.track.artists?.[0]?.id
    if (primaryArtistId) {
      trackArtistIds.add(primaryArtistId)
    }

    // Add all artist IDs and names from the track
    if (metric.track.artists && Array.isArray(metric.track.artists)) {
      for (const artist of metric.track.artists) {
        if (artist.id) {
          trackArtistIds.add(artist.id)
        }
        if (artist.name) {
          trackArtistNames.add(artist.name.toLowerCase().trim())
        }
      }
    }

    // Also add metric's artistName for comparison
    if (metric.artistName) {
      trackArtistNames.add(metric.artistName.toLowerCase().trim())
      // If no IDs, use name as fallback identifier
      if (trackArtistIds.size === 0) {
        trackArtistIds.add(metric.artistName.toLowerCase().trim())
      }
    }

    // Final fallback to track ID if nothing else is available
    if (trackArtistIds.size === 0 && trackArtistNames.size === 0) {
      trackArtistIds.add(metric.track.id)
    }

    // Check if ANY of this track's artists have already been selected
    const hasOverlappingArtistId = Array.from(trackArtistIds).some((id) =>
      artistIds.has(id)
    )
    const hasOverlappingArtistName = Array.from(trackArtistNames).some((name) =>
      artistNames.has(name)
    )

    return hasOverlappingArtistId || hasOverlappingArtistName
  }

  // Helper function to add an artist to the selected list
  const addToSelected = (metric: CandidateTrackMetrics): void => {
    selected.push(metric)

    // Track all artist IDs and names from this track
    const trackArtistIds = new Set<string>()
    const trackArtistNames = new Set<string>()

    const primaryArtistId = metric.artistId ?? metric.track.artists?.[0]?.id
    if (primaryArtistId) {
      trackArtistIds.add(primaryArtistId)
    }

    if (metric.track.artists && Array.isArray(metric.track.artists)) {
      for (const artist of metric.track.artists) {
        if (artist.id) {
          trackArtistIds.add(artist.id)
        }
        if (artist.name) {
          trackArtistNames.add(artist.name.toLowerCase().trim())
        }
      }
    }

    if (metric.artistName) {
      trackArtistNames.add(metric.artistName.toLowerCase().trim())
      if (trackArtistIds.size === 0) {
        trackArtistIds.add(metric.artistName.toLowerCase().trim())
      }
    }

    if (trackArtistIds.size === 0 && trackArtistNames.size === 0) {
      trackArtistIds.add(metric.track.id)
    }

    // Add all artist IDs and names to prevent future overlaps
    trackArtistIds.forEach((id) => artistIds.add(id))
    trackArtistNames.forEach((name) => artistNames.add(name))
  }

  // Select balanced tracks using weighted allocation instead of round-robin
  function selectBalancedTracks(
    categories: {
      closer: CandidateTrackMetrics[]
      neutral: CandidateTrackMetrics[]
      further: CandidateTrackMetrics[]
    },
    targetCount: number = 9
  ): CandidateTrackMetrics[] {
    const selected: CandidateTrackMetrics[] = []
    const categoryCounts = { closer: 0, neutral: 0, further: 0 }

    logger(
      'INFO',
      `Starting weighted selection. Target: ${targetCount} tracks`,
      'selectBalancedTracks'
    )

    // Phase 1: Guarantee minimums for each category using best quality tracks
    const categoryKeys: (keyof typeof categories)[] = [
      'closer',
      'neutral',
      'further'
    ]

    for (const categoryKey of categoryKeys) {
      const guaranteed = GUARANTEED_MINIMUMS[categoryKey]
      const candidates = categories[categoryKey]

      // Sort by quality (use a simple heuristic if no quality scores available)
      const sortedCandidates = candidates.sort((a, b) => {
        // Use final score as quality proxy for now
        return b.finalScore - a.finalScore
      })

      for (const candidate of sortedCandidates.slice(0, guaranteed)) {
        if (!isArtistSelected(candidate)) {
          candidate.selectionCategory = categoryKey
          addToSelected(candidate)
          selected.push(candidate)
          categoryCounts[categoryKey]++
          logger(
            'INFO',
            `  Phase 1: Selected ${categoryKey} track (${categoryCounts[categoryKey]}/${guaranteed} min): ${candidate.artistName} | Score=${candidate.finalScore.toFixed(3)}`,
            'selectBalancedTracks'
          )
        }
      }
    }

    logger(
      'INFO',
      `Phase 1 complete: Closer=${categoryCounts.closer}/${GUARANTEED_MINIMUMS.closer} | Neutral=${categoryCounts.neutral}/${GUARANTEED_MINIMUMS.neutral} | Further=${categoryCounts.further}/${GUARANTEED_MINIMUMS.further} | Total=${selected.length}`,
      'selectBalancedTracks'
    )

    // Phase 2: Fill remaining slots using weighted selection
    while (selected.length < targetCount) {
      const remainingSlots = targetCount - selected.length

      // Calculate available candidates per category
      const availableCounts = {
        closer: categories.closer.filter((c) => !isArtistSelected(c)).length,
        neutral: categories.neutral.filter((c) => !isArtistSelected(c)).length,
        further: categories.further.filter((c) => !isArtistSelected(c)).length
      }

      // Skip categories that have reached their maximum (3 total) or have no candidates
      const eligibleCategories = categoryKeys.filter(
        (key) => categoryCounts[key] < 3 && availableCounts[key] > 0
      )

      if (eligibleCategories.length === 0) {
        logger(
          'WARN',
          `No eligible categories remaining. Stopping at ${selected.length}/${targetCount} tracks`,
          'selectBalancedTracks'
        )
        break
      }

      // Select category using weighted probabilities
      let selectedCategory: keyof typeof categories | null = null
      const random = Math.random()
      let cumulativeWeight = 0

      for (const category of eligibleCategories) {
        cumulativeWeight += CATEGORY_WEIGHTS[category]
        if (random <= cumulativeWeight) {
          selectedCategory = category
          break
        }
      }

      // Fallback to first eligible category if weights didn't select one
      if (!selectedCategory) {
        selectedCategory = eligibleCategories[0]
      }

      // Select best available candidate from chosen category
      const candidates = categories[selectedCategory].filter(
        (c) => !isArtistSelected(c)
      )
      if (candidates.length === 0) {
        logger(
          'WARN',
          `No candidates available in ${selectedCategory} category`,
          'selectBalancedTracks'
        )
        continue
      }

      // Sort by quality and select the best
      const bestCandidate = candidates.sort(
        (a, b) => b.finalScore - a.finalScore
      )[0]
      bestCandidate.selectionCategory = selectedCategory
      addToSelected(bestCandidate)
      selected.push(bestCandidate)
      categoryCounts[selectedCategory]++

      logger(
        'INFO',
        `  Phase 2: Selected ${selectedCategory} track (${categoryCounts[selectedCategory]}/3): ${bestCandidate.artistName} | Score=${bestCandidate.finalScore.toFixed(3)} | Remaining slots: ${remainingSlots - 1}`,
        'selectBalancedTracks'
      )
    }

    logger(
      'INFO',
      `Weighted selection complete: Closer=${categoryCounts.closer} | Neutral=${categoryCounts.neutral} | Further=${categoryCounts.further} | Total=${selected.length}/${targetCount}`,
      'selectBalancedTracks'
    )

    return selected
  }

  // Step 1: Select 3 tracks from each strategic category using weighted allocation
  const TRACKS_PER_CATEGORY = 3

  logger(
    'INFO',
    'Selecting tracks from each strategic category using weighted allocation...',
    'applyDiversityConstraints'
  )
  logger(
    'INFO',
    `Category sizes before selection: Closer=${goodCandidates.length} | Neutral=${neutralCandidates.length} | Further=${badCandidates.length}`,
    'applyDiversityConstraints'
  )

  // Always ensure we have at least TRACKS_PER_CATEGORY candidates in each category
  // If any category is short, redistribute using percentile approach
  // Force redistribution if all differences are on one side (all positive or all negative)
  // When all differences are positive, we must use percentile split to create 3-3-3 mix
  // Use more aggressive split when differences are very small (tightly clustered)
  let needsRedistribution =
    goodCandidates.length < TRACKS_PER_CATEGORY ||
    badCandidates.length < TRACKS_PER_CATEGORY ||
    neutralCandidates.length < TRACKS_PER_CATEGORY ||
    allPositive ||
    allNegative

  if (needsRedistribution) {
    logger(
      'WARN',
      `Insufficient candidates in categories (Closer=${goodCandidates.length}, Neutral=${neutralCandidates.length}, Further=${badCandidates.length}). Redistributing using percentile approach...`,
      'applyDiversityConstraints'
    )

    // Use more aggressive split when differences are very small
    // If diffRange < 0.05, use 30/30/40 split instead of 33/33/33
    const useAggressiveSplit = diffRange < 0.05
    const topPercent = useAggressiveSplit ? 0.3 : 0.33
    const bottomPercent = useAggressiveSplit ? 0.3 : 0.33
    const middlePercent = useAggressiveSplit ? 0.4 : 0.34

    const totalAvailable = candidatesWithDiff.length
    const topSize = Math.max(
      TRACKS_PER_CATEGORY * 2,
      Math.floor(totalAvailable * topPercent)
    )
    const bottomSize = Math.max(
      TRACKS_PER_CATEGORY * 2,
      Math.floor(totalAvailable * bottomPercent)
    )
    const thirdSize = Math.max(
      TRACKS_PER_CATEGORY * 2,
      Math.floor(totalAvailable / 3)
    )

    logger(
      'INFO',
      `Using ${useAggressiveSplit ? 'aggressive' : 'standard'} percentile split (range=${diffRange.toFixed(3)}): Top=${topSize}, Bottom=${bottomSize}, Middle=${thirdSize}`,
      'applyDiversityConstraints'
    )

    // Top portion = closer (best relative to baseline, sorted by diff descending)
    const topThird = candidatesWithDiff
      .sort((a, b) => b.diff - a.diff)
      .slice(0, topSize)
      .map((item) => item.metric)

    // Bottom portion = further (worst relative to baseline, sorted by diff ascending)
    const bottomThird = candidatesWithDiff
      .sort((a, b) => a.diff - b.diff)
      .slice(0, bottomSize)
      .map((item) => item.metric)

    // Middle third = neutral (closest to baseline)
    const used = new Set([...topThird, ...bottomThird])
    const middleThird = candidatesWithDiff
      .filter((item) => !used.has(item.metric))
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff)) // Closest to baseline first
      .slice(0, Math.max(thirdSize, TRACKS_PER_CATEGORY * 2))
      .map((item) => item.metric)

    // Update categories - ensure we have at least 6 candidates per category before selection
    const MIN_CANDIDATES_PER_CATEGORY = 6
    goodCandidates.length = 0
    goodCandidates.push(
      ...topThird.slice(
        0,
        Math.max(
          MIN_CANDIDATES_PER_CATEGORY,
          Math.min(TRACKS_PER_CATEGORY * 3, topThird.length)
        )
      )
    )

    badCandidates.length = 0
    badCandidates.push(
      ...bottomThird.slice(
        0,
        Math.max(
          MIN_CANDIDATES_PER_CATEGORY,
          Math.min(TRACKS_PER_CATEGORY * 3, bottomThird.length)
        )
      )
    )

    neutralCandidates.length = 0
    neutralCandidates.push(
      ...middleThird.slice(
        0,
        Math.max(
          MIN_CANDIDATES_PER_CATEGORY,
          Math.min(TRACKS_PER_CATEGORY * 3, middleThird.length)
        )
      )
    )

    // If neutral is still too small, take from edges (closest to baseline)
    if (neutralCandidates.length < MIN_CANDIDATES_PER_CATEGORY) {
      const allUnused = candidatesWithDiff
        .filter((item) => !used.has(item.metric))
        .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff)) // Closest to baseline first
        .map((item) => item.metric)
      const needed = MIN_CANDIDATES_PER_CATEGORY - neutralCandidates.length
      neutralCandidates.push(...allUnused.slice(0, needed))
    }

    logger(
      'INFO',
      `After percentile redistribution: Closer=${goodCandidates.length} (min=${MIN_CANDIDATES_PER_CATEGORY}) | Neutral=${neutralCandidates.length} (min=${MIN_CANDIDATES_PER_CATEGORY}) | Further=${badCandidates.length} (min=${MIN_CANDIDATES_PER_CATEGORY})`,
      'applyDiversityConstraints'
    )
  }

  // Step 1: Select balanced tracks using weighted allocation
  const categoryCandidates = {
    closer: goodCandidates,
    neutral: neutralCandidates,
    further: badCandidates
  }

  const balancedSelection = selectBalancedTracks(
    categoryCandidates,
    DISPLAY_OPTION_COUNT
  )

  // Split back into category arrays for compatibility with existing code
  const closerSelected = balancedSelection.filter(
    (c) => c.selectionCategory === 'closer'
  )
  const neutralSelected = balancedSelection.filter(
    (c) => c.selectionCategory === 'neutral'
  )
  const furtherSelected = balancedSelection.filter(
    (c) => c.selectionCategory === 'further'
  )

  // Log final distribution
  const achievedBalance =
    closerSelected.length === TRACKS_PER_CATEGORY &&
    neutralSelected.length === TRACKS_PER_CATEGORY &&
    furtherSelected.length === TRACKS_PER_CATEGORY
  const balanceStatus = achievedBalance ? '✅ ACHIEVED' : '⚠️ PARTIAL'

  logger(
    'INFO',
    `Round-robin selection complete (${balanceStatus}): Closer=${closerSelected.length}/${TRACKS_PER_CATEGORY} | Neutral=${neutralSelected.length}/${TRACKS_PER_CATEGORY} | Further=${furtherSelected.length}/${TRACKS_PER_CATEGORY}${needsRedistribution ? ' | Used percentile redistribution' : ''}`,
    'applyDiversityConstraints'
  )

  // Step 2: Handle insufficient tracks - try to maintain 3-3-3 distribution
  const totalSelected =
    closerSelected.length + neutralSelected.length + furtherSelected.length

  if (totalSelected < DISPLAY_OPTION_COUNT) {
    logger(
      'WARN',
      `Insufficient tracks after round-robin: Closer=${closerSelected.length} | Neutral=${neutralSelected.length} | Further=${furtherSelected.length} (need ${DISPLAY_OPTION_COUNT})`,
      'applyDiversityConstraints'
    )

    // Try to fill missing slots while maintaining 3-3-3 balance
    // Only fill categories that are below 3, never exceed 3
    // Define categories structure for filling logic
    const allCategories = [
      { label: 'Closer', candidates: goodCandidates, selected: closerSelected },
      {
        label: 'Neutral',
        candidates: neutralCandidates,
        selected: neutralSelected
      },
      { label: 'Further', candidates: badCandidates, selected: furtherSelected }
    ]

    const categoryNeeds = [
      {
        category: allCategories[0],
        needed: Math.max(0, TRACKS_PER_CATEGORY - closerSelected.length)
      },
      {
        category: allCategories[1],
        needed: Math.max(0, TRACKS_PER_CATEGORY - neutralSelected.length)
      },
      {
        category: allCategories[2],
        needed: Math.max(0, TRACKS_PER_CATEGORY - furtherSelected.length)
      }
    ]
      .filter((c) => c.needed > 0)
      .sort((a, b) => b.needed - a.needed) // Fill most-needed first

    for (const { category, needed } of categoryNeeds) {
      let filled = 0
      for (const candidate of category.candidates) {
        // Stop if we've filled this category to exactly 3
        if (category.selected.length >= TRACKS_PER_CATEGORY) break
        if (filled >= needed) break
        if (!isArtistSelected(candidate)) {
          candidate.selectionCategory = category.label.toLowerCase() as
            | 'closer'
            | 'neutral'
            | 'further'
          addToSelected(candidate)
          category.selected.push(candidate)
          filled++
          logger(
            'INFO',
            `  Filled ${category.label} slot (${category.selected.length}/${TRACKS_PER_CATEGORY}): ${candidate.artistName} | Sim=${candidate.simScore.toFixed(3)}`,
            'applyDiversityConstraints'
          )
        }
      }
    }

    // Final check - if still not enough, try to maintain balance
    // Only add to categories that are below 3, never exceed 3
    const stillNeeded = DISPLAY_OPTION_COUNT - selected.length
    if (stillNeeded > 0) {
      logger(
        'WARN',
        `Still need ${stillNeeded} more tracks. Attempting balanced fill...`,
        'applyDiversityConstraints'
      )

      // Try to fill remaining slots while maintaining 3-3-3 balance
      // Distribute remaining needs across categories that are below 3
      const remainingNeeds = categoryNeeds.filter((c) => c.needed > 0)
      if (remainingNeeds.length > 0) {
        // Distribute evenly across categories that need more
        const perCategory = Math.ceil(stillNeeded / remainingNeeds.length)
        for (const { category, needed } of remainingNeeds) {
          const toFill = Math.min(
            perCategory,
            needed,
            stillNeeded - (DISPLAY_OPTION_COUNT - selected.length)
          )
          if (toFill <= 0) continue

          let filled = 0
          for (const candidate of category.candidates) {
            if (category.selected.length >= TRACKS_PER_CATEGORY) break
            if (filled >= toFill) break
            if (!isArtistSelected(candidate)) {
              candidate.selectionCategory = category.label.toLowerCase() as
                | 'closer'
                | 'neutral'
                | 'further'
              addToSelected(candidate)
              category.selected.push(candidate)
              filled++
              logger(
                'INFO',
                `  Final balanced fill ${category.label} (${category.selected.length}/${TRACKS_PER_CATEGORY}): ${candidate.artistName}`,
                'applyDiversityConstraints'
              )
            }
          }
        }
      }

      // If we still don't have 9, fill from any remaining (shouldn't happen if logic is correct)
      const finalNeeded = DISPLAY_OPTION_COUNT - selected.length
      if (finalNeeded > 0) {
        logger(
          'ERROR',
          `CRITICAL: Still need ${finalNeeded} tracks after all fill attempts. This should not happen.`,
          'applyDiversityConstraints'
        )
        const allRemaining = sortedFilteredMetrics.filter(
          (m) => !isArtistSelected(m)
        )
        for (const candidate of allRemaining.slice(0, finalNeeded)) {
          // Determine best-fit category
          const diff =
            getCurrentPlayerAttraction(candidate) -
            candidate.currentSongAttraction

          if (allPositive || allNegative) {
            // If distribution is skewed (forced percentile), late additions are effectively 'neutral'
            // relative to the enforced extremes.
            candidate.selectionCategory = 'neutral'
          } else {
            if (diff > NEUTRAL_TOLERANCE) candidate.selectionCategory = 'closer'
            else if (diff < -NEUTRAL_TOLERANCE)
              candidate.selectionCategory = 'further'
            else candidate.selectionCategory = 'neutral'
          }

          addToSelected(candidate)
        }
      }
    }
  }

  logger(
    'INFO',
    `Strategic distribution: Closer=${closerSelected.length} | Neutral=${neutralSelected.length} | Further=${furtherSelected.length} | Total=${selected.length}`,
    'applyDiversityConstraints'
  )

  // Log final selection summary
  logger(
    'INFO',
    `Selection complete: ${selected.length} options from ${sortedFilteredMetrics.length} candidates`,
    'applyDiversityConstraints'
  )

  // Log each selected track with its category and metrics
  selected.forEach((metric, index) => {
    const artistList =
      metric.track.artists?.map((a) => a.name).join(', ') ??
      metric.artistName ??
      'Unknown'

    // Determine category for this track based on comparison to baseline
    const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
    const baseline = metric.currentSongAttraction
    const diff = currentPlayerAttraction - baseline
    let category = 'NEUTRAL'
    if (diff > NEUTRAL_TOLERANCE) {
      category = 'CLOSER'
    } else if (diff < -NEUTRAL_TOLERANCE) {
      category = 'FURTHER'
    }

    logger(
      'INFO',
      `  Option ${index + 1} [${category}]: "${metric.track.name}" by ${artistList} | Sim=${metric.simScore.toFixed(3)} | Attraction=${currentPlayerAttraction.toFixed(3)} vs Baseline=${metric.currentSongAttraction.toFixed(3)}`,
      'applyDiversityConstraints'
    )
  })

  // Log similarity tier distribution in final selection
  const tierDistribution = {
    low: selected.filter((m) => m.simScore < 0.4).length,
    medium: selected.filter((m) => m.simScore >= 0.4 && m.simScore < 0.7)
      .length,
    high: selected.filter((m) => m.simScore >= 0.7).length
  }

  logger(
    'INFO',
    `Similarity tier distribution: Low (<0.4)=${tierDistribution.low} | Medium (0.4-0.7)=${tierDistribution.medium} | High (>0.7)=${tierDistribution.high}`,
    'applyDiversityConstraints'
  )

  // Log strategic distribution in final selection
  let finalCloser = 0
  let finalNeutral = 0
  let finalFurther = 0

  selected.forEach((metric) => {
    const currentPlayerAttraction = getCurrentPlayerAttraction(metric)
    const baseline = metric.currentSongAttraction
    const diff = currentPlayerAttraction - baseline
    if (diff > NEUTRAL_TOLERANCE) {
      finalCloser++
    } else if (diff < -NEUTRAL_TOLERANCE) {
      finalFurther++
    } else {
      finalNeutral++
    }
  })

  logger(
    'INFO',
    `Final strategic distribution for Player ${currentPlayerId}: Closer=${finalCloser} | Neutral=${finalNeutral} | Further=${finalFurther}`,
    'applyDiversityConstraints'
  )

  // Ensure we return exactly 3-3-3 by using the category arrays
  // The selected array might have extra tracks from fallback, so rebuild from categories
  const finalSelected = [
    ...closerSelected.slice(0, TRACKS_PER_CATEGORY),
    ...neutralSelected.slice(0, TRACKS_PER_CATEGORY),
    ...furtherSelected.slice(0, TRACKS_PER_CATEGORY)
  ]

  // If we don't have 9, fill from selected (shouldn't happen, but safety check)
  if (finalSelected.length < DISPLAY_OPTION_COUNT) {
    const missing = DISPLAY_OPTION_COUNT - finalSelected.length
    const additional = selected
      .filter((m) => !finalSelected.includes(m))
      .slice(0, missing)
    finalSelected.push(...additional)
  }

  // If we still don't have 9 tracks, this indicates a severe issue or extremely limited candidate pool.
  // We will now fall back to simply taking the top tracks from the original sorted list,
  // strictly maintaining artist uniqueness, but potentially violating diversity.
  // This is a last resort to ensure DISPLAY_OPTION_COUNT tracks are returned.
  if (finalSelected.length < DISPLAY_OPTION_COUNT) {
    const missing = DISPLAY_OPTION_COUNT - finalSelected.length
    logger(
      'WARN',
      `CRITICAL: Still missing ${missing} tracks after all attempts. Falling back to strict artist uniqueness from original candidates.`,
      'applyDiversityConstraints'
    )

    const usedArtistIds = new Set(finalSelected.map((m) => m.artistId))
    const additional = sortedFilteredMetrics
      .filter(
        (m) => !usedArtistIds.has(m.artistId) && !finalSelected.includes(m)
      )
      .slice(0, missing)

    additional.forEach((m) => {
      m.selectionCategory = m.selectionCategory || 'neutral' // Default if not set
      finalSelected.push(m)
      logger(
        'WARN',
        `  Strict fallback add: "${m.track.name}" by ${m.artistName}`,
        'applyDiversityConstraints'
      )
    })
  }

  logger(
    'INFO',
    `Final return: Closer=${closerSelected.slice(0, TRACKS_PER_CATEGORY).length} | Neutral=${neutralSelected.slice(0, TRACKS_PER_CATEGORY).length} | Further=${furtherSelected.slice(0, TRACKS_PER_CATEGORY).length} | Total=${finalSelected.length}`,
    'applyDiversityConstraints'
  )

  // Validate diversity: verify we achieved 3-3-3 distribution
  const actualCloser = closerSelected.slice(0, TRACKS_PER_CATEGORY).length
  const actualNeutral = neutralSelected.slice(0, TRACKS_PER_CATEGORY).length
  const actualFurther = furtherSelected.slice(0, TRACKS_PER_CATEGORY).length
  const achievedPerfectBalance =
    actualCloser === TRACKS_PER_CATEGORY &&
    actualNeutral === TRACKS_PER_CATEGORY &&
    actualFurther === TRACKS_PER_CATEGORY

  if (!achievedPerfectBalance) {
    logger(
      'WARN',
      `Diversity validation: Did not achieve perfect 3-3-3 balance. Actual: Closer=${actualCloser} | Neutral=${actualNeutral} | Further=${actualFurther}. ` +
      `Category sizes: Closer=${closerSelected.length} | Neutral=${neutralSelected.length} | Further=${furtherSelected.length}. ` +
      `Total candidates: ${sortedFilteredMetrics.length}. ` +
      `This may indicate insufficient diversity in candidate pool.`,
      'applyDiversityConstraints'
    )
  } else {
    logger(
      'INFO',
      `Diversity validation: Successfully achieved 3-3-3 balance`,
      'applyDiversityConstraints'
    )
  }

  return {
    selected: finalSelected.map((metric) => ({
      ...metric
    })),
    filteredArtistNames
  }
}

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

export const __dgsTestHelpers = {
  clampGravity,
  computeSimilarity,
  applyDiversityConstraints,
  getPopularityBand,
  extractTrackMetadata
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
  statisticsTracker?: ApiStatisticsTracker
): Promise<CandidateSeed[]> {
  const seeds: CandidateSeed[] = []
  const artistIdsSet = new Set(artistIds)

  // 1. Batch query DB
  const dbTopTracks = await timeDbQuery(
    `batchGetTopTracksFromDb (${artistIds.length} artists)`,
    () => batchGetTopTracksFromDb(artistIds)
  )

  // 2. Identify missing
  const missingArtistIds = artistIds.filter((id) => !dbTopTracks.has(id))

  // 3. Fetch missing from Spotify (limit 5 per batch for now to match logic)
  if (missingArtistIds.length > 0) {
    const MAX_MISSING_TO_FETCH = 5
    const artistsToFetch = missingArtistIds.slice(0, MAX_MISSING_TO_FETCH)

    await Promise.all(
      artistsToFetch.map(async (artistId) => {
        try {
          const tracks = await timeApiCall(
            `getArtistTopTracksServer (${artistId})`,
            () => getArtistTopTracksServer(artistId, token, statisticsTracker)
          )
          void upsertTopTracks(
            artistId,
            tracks.map((t) => t.id)
          )
          void upsertTrackDetails(tracks)
          dbTopTracks.set(artistId, tracks)
        } catch (e) {
          // ignore
        }
      })
    )
  }

  // 4. Build seeds
  dbTopTracks.forEach((tracks, artistId) => {
    // Only if requested
    if (artistIdsSet.has(artistId)) {
      tracks.slice(0, 1).forEach((track) => {
        if (track.is_playable) {
          seeds.push({ track, source: 'related_top_tracks' })
        }
      })
    }
  })

  return seeds
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
