import { useState, useRef, useCallback, useEffect } from 'react'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { tokenManager } from '@/shared/token/tokenManager'
import type { TargetArtist } from '@/services/gameService'
import type {
  DgsOptionTrack,
  DgsDebugInfo,
  PlayerGravityMap,
  PlayerTargetsMap,
  PlayerId,
  DgsSelectionMeta,
  TargetProfile,
  CandidateSeed,
  ArtistProfile
} from '@/services/game/dgsTypes'

// Helper to merge debug stats
const mergeDebugInfo = (
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

    merged.caching.cacheHitRate =
      totalReq > 0 ? merged.caching.totalCacheHits / totalReq : 0
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

  // Scoring: Take Stage 3 primarily, but if we need to merge others we could.
  // Usually Stage 3 has the final scoring.
  if (next.scoring) {
    merged.scoring = next.scoring
  }

  // Candidates: Merge arrays
  if (prev.candidates || next.candidates) {
    merged.candidates = [...(prev.candidates || []), ...(next.candidates || [])]
  }

  return merged
}

// Types for API response
interface InitRoundResponse {
  targetArtists: TargetArtist[]
  playerTargets?: PlayerTargetsMap
  optionTracks: DgsOptionTrack[]
  gravities: PlayerGravityMap
  candidatePoolSize: number
  vicinity: {
    triggered: boolean
    playerId?: PlayerId
  }
  debugInfo?: DgsDebugInfo
}

interface PrepSeedResponse {
  jobId: string
  status: 'ready' | 'warming'
  expiresAt?: number
  payload?: InitRoundResponse
}

interface UseGameDataProps {
  activePlayerId: PlayerId
  players: Array<{ id: PlayerId; targetArtist: TargetArtist | null }>
  playedTrackIds: string[]
  playerGravities: PlayerGravityMap
  roundTurn: number
  turnCounter: number
  onGravitiesUpdate: (gravities: PlayerGravityMap) => void
  onTargetsUpdate: (
    targets: PlayerTargetsMap,
    fallback?: TargetArtist[]
  ) => void
}

interface UseGameDataResult {
  options: DgsOptionTrack[]
  isBusy: boolean
  loadingStage: { stage: string; progress: number } | null
  error: string | null
  candidatePoolSize: number
  vicinity: { triggered: boolean; playerId?: PlayerId }
  debugInfo?: DgsDebugInfo

  // Actions
  refreshOptions: (
    playbackState: SpotifyPlaybackState | null,
    overrideTargets?: PlayerTargetsMap | null,
    skipTargetUpdate?: boolean,
    overridePlayedTrackIds?: string[],
    overrideActivePlayerId?: PlayerId,
    overrideGravities?: PlayerGravityMap
  ) => Promise<void>

  // Refs (state that needs to be accessed in async/callbacks without staleness)
  lastSeedTrackIdRef: React.MutableRefObject<string | null>
  lastCompletedSelectionRef: React.MutableRefObject<DgsSelectionMeta | null>
  clearOptions: () => void
}

export function useGameData({
  activePlayerId,
  players,
  playedTrackIds,
  playerGravities,
  roundTurn,
  turnCounter,
  onGravitiesUpdate,
  onTargetsUpdate
}: UseGameDataProps): UseGameDataResult {
  const [options, setOptions] = useState<DgsOptionTrack[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [loadingStage, setLoadingStage] = useState<{
    stage: string
    progress: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Server-side calculated stats
  const [candidatePoolSize, setCandidatePoolSize] = useState(0)
  const [vicinity, setVicinity] = useState<{
    triggered: boolean
    playerId?: PlayerId
  }>({ triggered: false })
  const [debugInfo, setDebugInfo] = useState<DgsDebugInfo | undefined>(
    undefined
  )
  const optionsRef = useRef<DgsOptionTrack[]>([])
  const lastRequestTrackIdRef = useRef<string | null>(null)

  const lastSeedTrackIdRef = useRef<string | null>(null)
  const lastCompletedSelectionRef = useRef<DgsSelectionMeta | null>(null)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // Helper to map current players to targets map
  const getCurrentPlayerTargets = useCallback((): PlayerTargetsMap => {
    return {
      player1: players.find((p) => p.id === 'player1')?.targetArtist ?? null,
      player2: players.find((p) => p.id === 'player2')?.targetArtist ?? null
    }
  }, [players])

  const clearOptions = useCallback(() => {
    setOptions([])
  }, [])

  // Pipeline Helper Types
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
    debug: DgsDebugInfo
  }

  interface Stage2Response {
    seeds: CandidateSeed[]
    profiles: ArtistProfile[]
    debug: any // DgsDebugInfo
  }

  interface Stage3Response {
    optionTracks: DgsOptionTrack[]
    debug: any // DgsDebugInfo
  }

  // NOTE: Importing types from dgsTypes is safe for client
  // But define locally if dgsTypes has server imports.
  // We moved strictly data interfaces to dgsTypes, so it should be fine.

  const refreshOptions = useCallback(
    async (
      playbackState: SpotifyPlaybackState | null,
      overrideTargets?: PlayerTargetsMap | null,
      skipTargetUpdate = false,
      overridePlayedTrackIds?: string[],
      overrideActivePlayerId?: PlayerId,
      overrideGravities?: PlayerGravityMap
    ) => {
      if (!playbackState) return

      setOptions([])
      setIsBusy(true)
      setLoadingStage({ stage: 'Analyzing Tracks...', progress: 10 })
      setError(null)

      try {
        const startTime = Date.now()
        lastSeedTrackIdRef.current = playbackState.item?.id ?? null

        const requestTargets = overrideTargets ?? getCurrentPlayerTargets()
        const lastSelectionPayload =
          lastCompletedSelectionRef.current ?? undefined
        const effectiveActivePlayerId = overrideActivePlayerId ?? activePlayerId
        const effectiveGravities = overrideGravities ?? playerGravities
        const sentRoundNumber = Math.max(1, Math.floor(roundTurn))
        const sentTurnNumber = Math.max(1, Math.floor(turnCounter))

        const timeoutDuration = 120000 // Total timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration)

        try {
          // Get token for requests
          const token = await tokenManager.getToken()
          if (!token) throw new Error('No access token available')

          const authHeaders = { Authorization: `Bearer ${token}` }

          // --- STAGE 1: INIT ---
          // Resolves targets, seed, gravities, and candidate pool IDs (related artists)
          const stage1Res = await sendApiRequest<
            Stage1Response | { error: string }
          >({
            path: '/game/pipeline/stage1-init',
            method: 'POST',
            isLocalApi: true,
            extraHeaders: authHeaders,
            config: { signal: controller.signal },
            body: {
              playbackState,
              roundNumber: sentRoundNumber,
              turnNumber: sentTurnNumber,
              currentPlayerId: effectiveActivePlayerId,
              playerTargets: requestTargets,
              playerGravities: effectiveGravities,
              playedTrackIds: overridePlayedTrackIds ?? playedTrackIds,
              lastSelection: lastSelectionPayload
            }
          })

          if ('error' in stage1Res) throw new Error(stage1Res.error)

          // Update State from Stage 1 immediately where possible (e.g. gravities)
          // But strict update usually happens at end?
          // Gravities are returned here, so we can update them now or later.
          // Let's hold until success.

          const {
            targetProfiles,
            relatedArtistIds,
            currentTrack,
            updatedGravities,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            seedArtistId,
            ogDrift,
            hardConvergenceActive
          } = stage1Res

          // Accumulate Debug Info
          const stage1Debug = stage1Res.debug as any
          let accumulatedDebug: DgsDebugInfo | undefined = {
            caching: stage1Debug?.stats,
            executionTimeMs: stage1Debug?.executionTime,
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
            artistProfiles: {
              requested: 0,
              fetched: 0,
              missing: 0,
              successRate: 0
            },
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
            candidates: []
          }

          // Update Progress
          setLoadingStage({ stage: 'Finding Candidates...', progress: 30 })

          // --- STAGE 2: CANDIDATES (Parallel) ---
          // Fetch candidates for the related artists in chunks
          const CHUNK_SIZE = 5
          const allSeeds: CandidateSeed[] = []
          const allProfiles: ArtistProfile[] = []

          // Split IDs into chunks
          const chunks: string[][] = []
          for (let i = 0; i < relatedArtistIds.length; i += CHUNK_SIZE) {
            chunks.push(relatedArtistIds.slice(i, i + CHUNK_SIZE))
          }

          // Execute chunks in parallel (Promise.all)
          // With limited concurrency if needed, but for < ~50 items, 10 chunks is fine.
          const chunkPromises = chunks.map((chunk) =>
            sendApiRequest<Stage2Response | { error: string }>({
              path: '/game/pipeline/stage2-candidates',
              method: 'POST',
              isLocalApi: true,
              extraHeaders: authHeaders,
              config: { signal: controller.signal },
              body: {
                artistIds: chunk,
                playedTrackIds: overridePlayedTrackIds ?? playedTrackIds,
                currentArtistId: currentTrack.artists?.[0]?.id
              }
            })
          )

          // Custom Promise.all with progress tracking
          let completedChunks = 0
          const trackProgress = () => {
            completedChunks++
            const progress =
              30 + Math.floor((completedChunks / chunks.length) * 45) // 30% -> 75%
            setLoadingStage({
              stage: `Finding Candidates (${Math.round((completedChunks / chunks.length) * 100)}%)...`,
              progress
            })
          }

          const wrappedPromises = chunkPromises.map((p) =>
            p.then((res) => {
              trackProgress()
              return res
            })
          )

          const stage2Results = await Promise.all(wrappedPromises)

          // Aggregate results
          for (const res of stage2Results) {
            if ('error' in res) throw new Error(res.error)
            if (res.seeds) allSeeds.push(...res.seeds)
            if (res.profiles) allProfiles.push(...res.profiles)
            // Merge debug from chunks (mainly for caching/profile fetches)
            if (res.debug) {
              const debugData = res.debug as any
              const chunkDebug = {
                caching: debugData.stats, // Map stats to caching
                executionTimeMs: debugData.executionTime
              } as unknown as DgsDebugInfo
              accumulatedDebug = mergeDebugInfo(accumulatedDebug, chunkDebug)
            }
          }

          // --- STAGE 3: SCORE ---
          // Score candidates and select options
          setLoadingStage({ stage: 'Scoring Candidates...', progress: 80 })
          const stage3Res = await sendApiRequest<
            Stage3Response | { error: string }
          >({
            path: '/game/pipeline/stage3-score',
            method: 'POST',
            isLocalApi: true,
            extraHeaders: authHeaders,
            config: { signal: controller.signal },
            body: {
              seeds: allSeeds,
              profiles: allProfiles, // Pass enriched profiles
              targetProfiles,
              playerGravities: updatedGravities, // Use updated gravities from Stage 1
              currentTrack,
              relatedArtistIds, // Pass original list for relationship mapping if needed
              roundNumber: sentRoundNumber,
              currentPlayerId: effectiveActivePlayerId,
              ogDrift,
              hardConvergenceActive,
              playedTrackIds: overridePlayedTrackIds ?? playedTrackIds
            }
          })

          if ('error' in stage3Res) throw new Error(stage3Res.error)

          clearTimeout(timeoutId)

          // --- FINAL UPDATE ---

          setLoadingStage({ stage: 'Finalizing...', progress: 95 })
          lastCompletedSelectionRef.current = null

          if (!skipTargetUpdate) {
            // Reconstruct old response shape for targets logic
            const p1 = targetProfiles['player1']
            const p2 = targetProfiles['player2']

            let t1 = p1?.artist ?? null
            if (p1 && t1 && p1.genres?.length > 0) {
              t1 = {
                ...t1,
                genres: p1.genres,
                genre: p1.genres[0], // Set primary genre for display
                spotify_artist_id: p1.spotifyId || t1.spotify_artist_id
              }
            }

            let t2 = p2?.artist ?? null
            if (p2 && t2 && p2.genres?.length > 0) {
              t2 = {
                ...t2,
                genres: p2.genres,
                genre: p2.genres[0], // Set primary genre for display
                spotify_artist_id: p2.spotifyId || t2.spotify_artist_id
              }
            }

            const newTargetsMap: PlayerTargetsMap = {
              player1: t1,
              player2: t2
            }
            // Fallback list (just array of artists)
            const fallbackList: TargetArtist[] = []
            if (t1) fallbackList.push(t1)
            if (t2) fallbackList.push(t2)

            onTargetsUpdate(newTargetsMap, fallbackList)
          }

          if (updatedGravities) {
            onGravitiesUpdate(updatedGravities)
          }

          setCandidatePoolSize(allSeeds.length) // or from stage 3 stats
          setVicinity({ triggered: false }) // Simplified for now

          // Final merge with Stage 3 debug
          // Stage 3 debug structure might also be nested or flat.
          // Assuming Stage 3 returns full DgsDebugInfo, or partial.
          // Let's assume consistent pattern: if it has stats separate, we map it.
          // But Stage 3 usually returns the rich object.
          // Let's check stage3-score response in next step if this fails, but usually it returns constructed debug object.
          // Based on previous logs, it returns { debugInfo: ... } or just debug.

          // Final merge with Stage 3 debug
          if (stage3Res.debug) {
            let s3Debug = stage3Res.debug as any
            if (s3Debug.stats && !s3Debug.caching) {
              s3Debug = { ...s3Debug, caching: s3Debug.stats }
            }
            accumulatedDebug = mergeDebugInfo(accumulatedDebug, s3Debug)
          }

          if (accumulatedDebug) {
            setDebugInfo({ ...accumulatedDebug })
          }

          setOptions(stage3Res.optionTracks)
        } catch (error) {
          clearTimeout(timeoutId)
          throw error
        }
      } catch (gameError) {
        const message =
          gameError instanceof Error ? gameError.message : 'Pipeline Error'
        console.error('[useGameData] Pipeline Error:', gameError)
        setError(message)
        setOptions([])
      } finally {
        setIsBusy(false)
        setLoadingStage(null)
      }
    },
    [
      activePlayerId,
      getCurrentPlayerTargets,
      playedTrackIds,
      playerGravities,
      roundTurn,
      turnCounter,
      onGravitiesUpdate,
      onTargetsUpdate
    ]
  )

  return {
    options,
    isBusy,
    loadingStage,
    error,
    candidatePoolSize,
    vicinity,
    debugInfo,
    refreshOptions,
    lastSeedTrackIdRef,
    lastCompletedSelectionRef,
    clearOptions
  }
}
