import { useState, useRef, useCallback, useEffect } from 'react'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { TargetArtist } from '@/services/gameService'
import type {
  DgsOptionTrack,
  DgsDebugInfo,
  PlayerGravityMap,
  PlayerTargetsMap,
  PlayerId,
  DgsSelectionMeta
} from '@/services/game/dgsTypes'
import { runGameGenerationPipeline } from '@/services/game/clientPipeline'

// Types for API response
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

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000)

      try {
        lastSeedTrackIdRef.current = playbackState.item?.id ?? null

        const requestTargets = overrideTargets ?? getCurrentPlayerTargets()
        const effectiveActivePlayerId = overrideActivePlayerId ?? activePlayerId
        const effectiveGravities = overrideGravities ?? playerGravities
        const sentRoundNumber = Math.max(1, Math.floor(roundTurn))
        const sentTurnNumber = Math.max(1, Math.floor(turnCounter))

        const result = await runGameGenerationPipeline({
          playbackState,
          roundNumber: sentRoundNumber,
          turnNumber: sentTurnNumber,
          activePlayerId: effectiveActivePlayerId,
          playerTargets: requestTargets,
          playerGravities: effectiveGravities,
          playedTrackIds: overridePlayedTrackIds ?? playedTrackIds,
          lastSelection: lastCompletedSelectionRef.current ?? undefined,
          onProgress: (stage, progress) => setLoadingStage({ stage, progress }),
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        // Reset selection ref
        lastCompletedSelectionRef.current = null

        // Handle Updates
        if (!skipTargetUpdate && result.targetProfiles) {
          const { player1: p1, player2: p2 } = result.targetProfiles

          // Helper to process target profile
          const processProfile = (p: typeof p1) => {
            let t = p?.artist ?? null
            if (p && t && p.genres?.length > 0) {
              t = {
                ...t,
                genres: p.genres,
                genre: p.genres[0],
                spotify_artist_id: p.spotifyId || t.spotify_artist_id
              }
            }
            return t
          }

          const t1 = processProfile(p1)
          const t2 = processProfile(p2)

          const newTargetsMap: PlayerTargetsMap = { player1: t1, player2: t2 }
          const fallbackList: TargetArtist[] = []
          if (t1) fallbackList.push(t1)
          if (t2) fallbackList.push(t2)

          onTargetsUpdate(newTargetsMap, fallbackList)
        }

        if (result.updatedGravities) {
          onGravitiesUpdate(result.updatedGravities)
        }

        setCandidatePoolSize(result.candidatePoolSize)
        setVicinity(result.vicinity)
        setDebugInfo(result.debugInfo)
        setOptions(result.options)
      } catch (gameError) {
        clearTimeout(timeoutId)
        // If aborted, we might ignore, but for now treat as error or silent
        if (
          gameError instanceof DOMException &&
          gameError.name === 'AbortError'
        ) {
          console.log('[useGameData] Request timeout or aborted')
        } else {
          const message =
            gameError instanceof Error ? gameError.message : 'Pipeline Error'
          console.error('[useGameData] Pipeline Error:', gameError)
          setError(message)
        }
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
