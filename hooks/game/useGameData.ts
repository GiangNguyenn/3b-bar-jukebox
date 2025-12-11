import { useState, useRef, useCallback } from 'react'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import type { TargetArtist } from '@/services/gameService'
import type {
  DgsOptionTrack,
  DgsDebugInfo,
  PlayerGravityMap,
  PlayerTargetsMap,
  PlayerId,
  DgsSelectionMeta
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

  const lastSeedTrackIdRef = useRef<string | null>(null)
  const lastCompletedSelectionRef = useRef<DgsSelectionMeta | null>(null)

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

      // Keep existing options while loading to avoid flicker during selection
      setIsBusy(true)
      setError(null)

      try {
        lastSeedTrackIdRef.current = playbackState.item?.id ?? null

        // Use override targets if provided, otherwise use current players
        const requestTargets = overrideTargets ?? getCurrentPlayerTargets()
        const lastSelectionPayload =
          lastCompletedSelectionRef.current ?? undefined

        // Use override active player ID if provided, otherwise use current activePlayerId
        const effectiveActivePlayerId = overrideActivePlayerId ?? activePlayerId
        // Use override gravities if provided, otherwise use current playerGravities
        const effectiveGravities = overrideGravities ?? playerGravities

        // Ensure we send valid numbers
        const sentRoundNumber = Math.max(1, Math.floor(roundTurn))
        const sentTurnNumber = Math.max(1, Math.floor(turnCounter))

        const timeoutDuration = sentRoundNumber <= 3 ? 120000 : 60000
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          controller.abort()
        }, timeoutDuration)

        let response: InitRoundResponse | { error: string }
        try {
          response = await sendApiRequest<
            InitRoundResponse | { error: string }
          >({
            path: '/game/init-round',
            method: 'POST',
            isLocalApi: true,
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
          clearTimeout(timeoutId)
        } catch (error) {
          clearTimeout(timeoutId)
          const errorMessage =
            error instanceof Error ? error.message : String(error)

          if (
            (error instanceof Error && error.name === 'AbortError') ||
            errorMessage.includes('aborted')
          ) {
            const timeoutSeconds = Math.floor(timeoutDuration / 1000)
            throw new Error(
              `Request timed out after ${timeoutSeconds} seconds. The game engine is still building the music database.`
            )
          }
          throw error
        }

        if ('error' in response) {
          throw new Error(response.error)
        }

        // Success - clear pending selection metadata
        lastCompletedSelectionRef.current = null

        // Update state
        if (!skipTargetUpdate) {
          onTargetsUpdate(
            response.playerTargets ?? { player1: null, player2: null },
            response.targetArtists
          )
        }

        if (response.gravities) {
          onGravitiesUpdate(response.gravities)
        }

        setCandidatePoolSize(response.candidatePoolSize ?? 0)
        setVicinity(response.vicinity ?? { triggered: false })
        setDebugInfo(response.debugInfo)

        // Filter options
        const excludedIds = new Set<string>(
          [playbackState.item?.id ?? '', ...playedTrackIds].filter(Boolean)
        )
        const filteredOptions = response.optionTracks.filter(
          (opt) => opt.track && !excludedIds.has(opt.track.id)
        )

        setOptions(filteredOptions)
      } catch (gameError) {
        const message =
          gameError instanceof Error
            ? gameError.message
            : 'Failed to refresh related songs.'
        console.error('[useGameData] Error:', gameError)
        setError(message)
      } finally {
        setIsBusy(false)
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
