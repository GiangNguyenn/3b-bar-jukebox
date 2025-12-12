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
    debug: any
  }

  interface Stage3Response {
    optionTracks: DgsOptionTrack[]
    debug: any
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
      setLoadingStage({ stage: 'Starting prep…', progress: 10 })
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

          const stage2Results = await Promise.all(chunkPromises)

          // Aggregate results
          for (const res of stage2Results) {
            if ('error' in res) throw new Error(res.error)
            if (res.seeds) allSeeds.push(...res.seeds)
            if (res.profiles) allProfiles.push(...res.profiles)
          }

          // --- STAGE 3: SCORE ---
          // Score candidates and select options
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
              hardConvergenceActive
            }
          })

          if ('error' in stage3Res) throw new Error(stage3Res.error)

          clearTimeout(timeoutId)

          // --- FINAL UPDATE ---
          lastCompletedSelectionRef.current = null

          if (!skipTargetUpdate) {
            // Reconstruct old response shape for targets logic?
            // Stage 1 returned targetProfiles.
            // We need to map targetProfiles back to simple TargetArtist list if needed?
            // The hook uses explicit `onTargetsUpdate`.
            // `targetProfiles` is { [id]: TargetProfile }.
            // We can extract TargetArtist from TargetProfile.artist.
            const t1 = targetProfiles['player1']?.artist ?? null
            const t2 = targetProfiles['player2']?.artist ?? null

            // Wait, `onTargetsUpdate` expects `PlayerTargetsMap` (TargetArtist | null) AND fallback list?
            // Stage 1 resolves "safeTargets".
            // We can construct the map.
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
          setDebugInfo({
            ...stage3Res.debug,
            pipelineExecutionTime: Date.now() - startTime
          })

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
