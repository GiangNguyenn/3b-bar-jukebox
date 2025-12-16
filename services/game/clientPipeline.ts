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
  CandidateSeed,
  ArtistProfile,
  DgsSelectionMeta
} from './dgsTypes'
import type { TargetArtist } from '../gameService'
import { mergeDebugInfo } from './debugUtils'

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
  targetProfiles: Record<PlayerId, TargetProfile | null>
  seedArtistId: string
  seedArtistName: string
  currentTrack: any // TrackDetails
  relatedArtistIds: string[]
  updatedGravities: PlayerGravityMap
  explorationPhase: any // ExplorationPhase
  hardConvergenceActive: boolean
  ogDrift: number
  debug: DgsDebugInfo | unknown
}

interface Stage2Response {
  seeds: CandidateSeed[]
  profiles: ArtistProfile[]
  debug: DgsDebugInfo | unknown
}

interface Stage3Response {
  optionTracks: DgsOptionTrack[]
  debug: DgsDebugInfo | unknown
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

  // --- STAGE 1: INIT ---
  const stage1Res = await sendApiRequest<Stage1Response | { error: string }>({
    path: '/game/pipeline/stage1-init',
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
    targetProfiles,
    relatedArtistIds,
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

  onProgress('Finding Candidates...', 30)

  // --- STAGE 2: CANDIDATES (Parallel Chunks) ---
  const CHUNK_SIZE = 5
  const allSeeds: CandidateSeed[] = []
  const allProfiles: ArtistProfile[] = []
  const chunks: string[][] = []

  for (let i = 0; i < relatedArtistIds.length; i += CHUNK_SIZE) {
    chunks.push(relatedArtistIds.slice(i, i + CHUNK_SIZE))
  }

  let completedChunks = 0
  const chunkPromises = chunks.map((chunk) =>
    sendApiRequest<Stage2Response | { error: string }>({
      path: '/game/pipeline/stage2-candidates',
      method: 'POST',
      isLocalApi: true,
      extraHeaders: authHeaders,
      config: { signal },
      body: {
        artistIds: chunk,
        playedTrackIds,
        currentArtistId: currentTrack.artists?.[0]?.id
      }
    }).then((res) => {
      completedChunks++
      const percent = Math.round((completedChunks / chunks.length) * 100)
      // Map 30% -> 75% range
      const uiProgress = 30 + Math.floor((completedChunks / chunks.length) * 45)
      onProgress(`Finding Candidates (${percent}%)...`, uiProgress)
      return res
    })
  )

  const stage2Results = await Promise.all(chunkPromises)

  for (const res of stage2Results) {
    if ('error' in res) throw new Error(res.error)
    if (res.seeds) allSeeds.push(...res.seeds)
    if (res.profiles) allProfiles.push(...res.profiles)

    if (res.debug) {
      const debugData = res.debug as any
      // Map 'stats' to 'caching' if needed
      const chunkDebug = {
        ...debugData,
        caching: debugData.stats || debugData.caching,
        executionTimeMs: debugData.executionTime || debugData.executionTimeMs
      } as DgsDebugInfo
      accumulatedDebug = mergeDebugInfo(accumulatedDebug, chunkDebug)
    }
  }

  // --- STAGE 3: SCORE ---
  onProgress('Scoring Candidates...', 80)

  const stage3Res = await sendApiRequest<Stage3Response | { error: string }>({
    path: '/game/pipeline/stage3-score',
    method: 'POST',
    isLocalApi: true,
    extraHeaders: authHeaders,
    config: { signal },
    body: {
      seeds: allSeeds,
      profiles: allProfiles,
      targetProfiles,
      playerGravities: updatedGravities,
      currentTrack,
      relatedArtistIds,
      roundNumber,
      currentPlayerId: activePlayerId,
      ogDrift,
      hardConvergenceActive,
      playedTrackIds
    }
  })

  if ('error' in stage3Res) throw new Error(stage3Res.error)

  // Merge final debug
  if (stage3Res.debug) {
    let s3Debug = stage3Res.debug as any
    if (s3Debug.stats && !s3Debug.caching) {
      s3Debug = { ...s3Debug, caching: s3Debug.stats }
    }
    accumulatedDebug = mergeDebugInfo(accumulatedDebug, s3Debug)
  }

  // Enrich candidatePool debug info with resolved names
  if (accumulatedDebug?.candidatePool) {
    const enrichArtists = (artists: { id: string; name: string }[] | undefined) => {
      if (!artists) return []
      return artists.map((a) => {
        const profile = allProfiles.find((p) => p.id === a.id)
        return {
          id: a.id,
          name: profile?.name ?? a.name // Use profile name if available (more reliable)
        }
      })
    }

    if (accumulatedDebug.candidatePool.seedArtists) {
      accumulatedDebug.candidatePool.seedArtists = enrichArtists(
        accumulatedDebug.candidatePool.seedArtists
      )
    }
    if (accumulatedDebug.candidatePool.targetArtists) {
      accumulatedDebug.candidatePool.targetArtists = enrichArtists(
        accumulatedDebug.candidatePool.targetArtists
      )
    }
  }

  onProgress('Finalizing...', 95)

  return {
    options: stage3Res.optionTracks,
    debugInfo: accumulatedDebug,
    candidatePoolSize: allSeeds.length,
    vicinity: { triggered: false }, // Simplified
    updatedGravities,
    targetProfiles,
    stage1Data: stage1Res,
    stage3Data: stage3Res as Stage3Response // Cast to ensure type matching
  }
}
