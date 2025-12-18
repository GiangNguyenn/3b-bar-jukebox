import { sendApiRequest } from '@/shared/api'
import { tokenManager } from '@/shared/token/tokenManager'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type {
  DgsOptionTrack,
  DgsDebugInfo,
  PlayerGravityMap,
  PlayerId,
  PlayerTargetsMap,
  TargetProfile,
  DgsSelectionMeta
} from './dgsTypes'
import type { TargetArtist } from '../gameService'
import { mergeDebugInfo } from './debugUtils'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('ClientPipeline')

interface PipelineConfig {
  playbackState: SpotifyPlaybackState
  roundNumber: number
  turnNumber: number
  activePlayerId: PlayerId
  playerTargets: PlayerTargetsMap
  playerGravities: PlayerGravityMap
  playedTrackIds: string[]
  lastSelection?: DgsSelectionMeta
  onProgress: (stage: string, progress: number) => void
  signal?: AbortSignal
}

export interface PipelineResult {
  options: DgsOptionTrack[]
  debugInfo?: DgsDebugInfo
  candidatePoolSize: number
  vicinity: {
    triggered: boolean
    playerId?: PlayerId
  }
  updatedGravities?: PlayerGravityMap
  targetProfiles?: Record<PlayerId, TargetProfile | null>
  // Raw data for other updates
  stage1Data: Stage1Response
  stage3Data: Stage3Response
}

// Internal Response Types
interface Stage1Response {
  artistIds: string[]
  relatedToCurrent: Array<{ name: string; id: string }>
  relatedToTarget: Array<{ name: string; id: string }>
  randomArtists: Array<{ name: string; id: string }>
  targetProfiles: Record<PlayerId, TargetProfile | null>
  currentTrack: any // TrackDetails
  seedArtistId: string
  seedArtistName: string
  updatedGravities: PlayerGravityMap
  explorationPhase: any // ExplorationPhase
  hardConvergenceActive: boolean
  ogDrift: number
  debug: DgsDebugInfo | unknown
}

interface Stage2Response {
  selectedArtists: Array<{
    artistId: string
    artistName: string
    category: 'CLOSER' | 'NEUTRAL' | 'FURTHER'
    attractionScore: number
    delta: number
  }>
  backupArtists?: Array<{
    artistId: string
    artistName: string
    category: 'CLOSER' | 'NEUTRAL' | 'FURTHER'
    attractionScore: number
    delta: number
  }>
  debugInfo: DgsDebugInfo
}

interface Stage3Response {
  options: DgsOptionTrack[]
  debugInfo: DgsDebugInfo
}

export async function runGameGenerationPipeline(
  config: PipelineConfig
): Promise<PipelineResult> {
  const {
    playbackState,
    roundNumber,
    turnNumber,
    activePlayerId,
    playerTargets,
    playerGravities,
    playedTrackIds,
    lastSelection,
    onProgress,
    signal
  } = config

  onProgress('Analyzing Tracks...', 10)

  // Get token (assumes client-side usage)
  const token = await tokenManager.getToken()
  if (!token) throw new Error('No access token available')
  const authHeaders = { Authorization: `Bearer ${token}` }

  // --- STAGE 1: ARTISTS ---
  onProgress('Building Artist Pool...', 20)
  const stage1Res = await sendApiRequest<Stage1Response | { error: string }>({
    path: '/game/pipeline/stage1-artists',
    method: 'POST',
    isLocalApi: true,
    extraHeaders: authHeaders,
    config: { signal },
    body: {
      playbackState,
      roundNumber,
      turnNumber,
      currentPlayerId: activePlayerId,
      playerTargets,
      playerGravities,
      playedTrackIds,
      lastSelection
    }
  })

  if ('error' in stage1Res) throw new Error(stage1Res.error)

  const {
    artistIds,
    relatedToCurrent,
    relatedToTarget,
    randomArtists,
    targetProfiles,
    currentTrack,
    updatedGravities,
    ogDrift,
    hardConvergenceActive
  } = stage1Res

  // Initialize Debug Info
  let accumulatedDebug: DgsDebugInfo | undefined = undefined

  // Parse Stage 1 Debug
  if (stage1Res.debug) {
    const s1Debug = stage1Res.debug as any
    // Handle potential structure differences if API returns slightly different shape
    // But ideally we fix the API to return DgsDebugInfo
    accumulatedDebug = {
      caching: s1Debug?.stats || s1Debug?.caching,
      executionTimeMs: s1Debug?.executionTime || s1Debug?.executionTimeMs,
      ...s1Debug
    }
  }

  // Initial debug structure if missing
  if (!accumulatedDebug) {
    accumulatedDebug = {
      targetProfiles: {
        player1: {
          resolved: !!targetProfiles['player1']?.genres?.length,
          artistName: targetProfiles['player1']?.artist.name ?? null,
          spotifyId: targetProfiles['player1']?.spotifyId ?? null,
          genresCount: targetProfiles['player1']?.genres?.length ?? 0
        },
        player2: {
          resolved: !!targetProfiles['player2']?.genres?.length,
          artistName: targetProfiles['player2']?.artist.name ?? null,
          spotifyId: targetProfiles['player2']?.spotifyId ?? null,
          genresCount: targetProfiles['player2']?.genres?.length ?? 0
        }
      },
      artistProfiles: { requested: 0, fetched: 0, missing: 0, successRate: 0 },
      scoring: {
        totalCandidates: 0,
        fallbackFetches: 0,
        p1NonZeroAttraction: 0,
        p2NonZeroAttraction: 0,
        zeroAttractionReasons: {
          missingArtistProfile: 0,
          nullTargetProfile: 0,
          zeroSimilarity: 0
        }
      },
      candidates: [],
      caching: {
        topTracksRequested: 0,
        topTracksCached: 0,
        topTracksFromSpotify: 0,
        topTracksApiCalls: 0,
        trackDetailsRequested: 0,
        trackDetailsCached: 0,
        trackDetailsFromSpotify: 0,
        trackDetailsApiCalls: 0,
        relatedArtistsRequested: 0,
        relatedArtistsCached: 0,
        relatedArtistsFromSpotify: 0,
        relatedArtistsApiCalls: 0,
        artistProfilesRequested: 0,
        artistProfilesCached: 0,
        artistProfilesFromSpotify: 0,
        artistProfilesApiCalls: 0,
        artistSearchesRequested: 0,
        artistSearchesCached: 0,
        artistSearchesFromSpotify: 0,
        artistSearchesApiCalls: 0,
        cacheHitRate: 0,
        totalApiCalls: 0,
        totalCacheHits: 0
      }
    }
  }

  // Merge Stage 1 debug info
  if (stage1Res.debug) {
    const s1Debug = stage1Res.debug as any
    accumulatedDebug = {
      caching: s1Debug?.stats || s1Debug?.caching,
      executionTimeMs: s1Debug?.executionTime || s1Debug?.executionTimeMs,
      candidatePool: s1Debug?.candidatePool,
      ...s1Debug
    }
  }

  // --- STAGE 2: SCORE ARTISTS ---
  const artistCount = artistIds.length // Should be ~100
  logger(
    'INFO',
    `Stage 1 returned ${artistCount} artists. Passing to Stage 2...`,
    'runGameGenerationPipeline'
  )

  onProgress('Scoring Artists...', 50)
  const stage2Res = await sendApiRequest<Stage2Response | { error: string }>({
    path: '/game/pipeline/stage2-score-artists',
    method: 'POST',
    isLocalApi: true,
    extraHeaders: authHeaders,
    config: { signal },
    body: {
      artistIds,
      targetProfiles,
      playerGravities: updatedGravities,
      currentTrack,
      relatedArtistIds: artistIds, // All artists are related in some way
      roundNumber,
      currentPlayerId: activePlayerId,
      ogDrift,
      hardConvergenceActive,
      relatedToCurrent,
      relatedToTarget,
      randomArtists
    }
  })

  if ('error' in stage2Res) throw new Error(stage2Res.error)

  // Merge Stage 2 debug info
  if (stage2Res.debugInfo) {
    accumulatedDebug = mergeDebugInfo(accumulatedDebug, stage2Res.debugInfo)
  }

  // --- STAGE 3: FETCH TRACKS ---
  onProgress('Fetching Tracks...', 80)
  const stage3Res = await sendApiRequest<Stage3Response | { error: string }>({
    path: '/game/pipeline/stage3-fetch-tracks',
    method: 'POST',
    isLocalApi: true,
    extraHeaders: authHeaders,
    config: { signal },
    body: {
      selectedArtists: stage2Res.selectedArtists,
      backupArtists: stage2Res.backupArtists, // Pass backups to Stage 3
      currentTrack,
      playedTrackIds,
      targetProfiles,
      playerGravities: updatedGravities,
      currentPlayerId: activePlayerId,
      roundNumber,
      hardConvergenceActive,
      ogDrift
    }
  })

  if ('error' in stage3Res) throw new Error(stage3Res.error)

  // Merge Stage 3 debug info
  if (stage3Res.debugInfo) {
    accumulatedDebug = mergeDebugInfo(accumulatedDebug, stage3Res.debugInfo)
  }

  onProgress('Finalizing...', 95)

  // Use the actual total candidates from scoring debug info
  const actualPoolSize =
    accumulatedDebug?.scoring?.totalCandidates ??
    stage2Res.selectedArtists.length

  // Construct Timing Breakdown
  if (accumulatedDebug) {
    const s1Time = (stage1Res.debug as any)?.executionTimeMs ?? 0
    const s2Time = stage2Res.debugInfo?.executionTimeMs ?? 0
    const s3Time = stage3Res.debugInfo?.executionTimeMs ?? 0

    // Extract detailed timing from Stage 2 if available
    const s2Timing = stage2Res.debugInfo?.timingBreakdown as any
    const enrichmentMs = s2Timing?.enrichmentMs ?? 0
    const targetResolutionMs = s2Timing?.targetResolutionMs ?? 0
    const scoringMs = s2Timing?.scoringMs ?? s2Time

    accumulatedDebug.timingBreakdown = {
      candidatePoolMs: s1Time, // Stage 1 covers pool
      targetResolutionMs, // From Stage 2
      enrichmentMs, // From Stage 2
      scoringMs, // From Stage 2
      selectionMs: s3Time, // Stage 3 is selection/fetching
      totalMs: s1Time + s2Time + s3Time
    }

    // Update total execution time
    accumulatedDebug.executionTimeMs = accumulatedDebug.timingBreakdown.totalMs
  }

  return {
    options: stage3Res.options,
    debugInfo: accumulatedDebug,
    candidatePoolSize: actualPoolSize,
    vicinity: { triggered: false }, // Simplified
    updatedGravities,
    targetProfiles,
    stage1Data: stage1Res,
    stage3Data: stage3Res
  }
}
