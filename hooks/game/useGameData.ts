import { useState, useRef, useCallback, useEffect } from 'react'
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

  const triggerLazyUpdateTick = useCallback(() => {
    void fetch('/api/game/lazy-update-tick', { method: 'POST' }).catch(() => {
      // Best-effort: ignore failures to keep gameplay responsive
    })
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

      const currentTrackId = playbackState.item?.id ?? null
      const isSameTrackRequest =
        !overrideTargets &&
        currentTrackId &&
        lastRequestTrackIdRef.current === currentTrackId &&
        optionsRef.current.length > 0

      if (isSameTrackRequest) return
      lastRequestTrackIdRef.current = currentTrackId

      // Keep existing options while loading to avoid flicker during selection
      setIsBusy(true)
      setLoadingStage({ stage: 'Starting prep…', progress: 10 })
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

        // Step 1: kick off prep-seed (fire-and-forget-ish, but wait for response)
        let prepJobId: string | undefined
        try {
          const prepRes = await fetch('/api/game/prep-seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playbackState,
              roundNumber: sentRoundNumber,
              turnNumber: sentTurnNumber,
              currentPlayerId: effectiveActivePlayerId,
              playerTargets: requestTargets,
              playerGravities: effectiveGravities,
              playedTrackIds: overridePlayedTrackIds ?? playedTrackIds
            })
          })
          const prepJson = (await prepRes.json()) as PrepSeedResponse
          prepJobId = prepJson.jobId
          console.info(
            '[useGameData] prep-seed status=%s jobId=%s',
            prepJson.status,
            prepJobId
          )
          if (prepJson.status === 'ready') {
            setLoadingStage({ stage: 'Prep ready', progress: 60 })
            if (prepJson.payload) {
              // If prep already returned payload, use it directly
              const response = prepJson.payload
              lastCompletedSelectionRef.current = null
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
              const excludedIds = new Set<string>(
                [playbackState.item?.id ?? '', ...playedTrackIds].filter(
                  Boolean
                )
              )
              const filteredOptions = response.optionTracks.filter(
                (opt) => opt.track && !excludedIds.has(opt.track.id)
              )
              setOptions(filteredOptions)
              triggerLazyUpdateTick()
              setLoadingStage({ stage: 'Ready', progress: 100 })
              setIsBusy(false)
              return
            }
          } else {
            setLoadingStage({ stage: 'Prep warming…', progress: 40 })
          }
        } catch (prepError) {
          console.error('[useGameData] prep-seed failed', prepError)
        }

        // Step 2: fetch options (poll if warming)
        const fetchOptions = async (): Promise<
          { warming: true } | { warming: false; data: InitRoundResponse }
        > => {
          setLoadingStage(
            (prev) => prev ?? { stage: 'Fetching options…', progress: 60 }
          )
          const res = await fetch('/api/game/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playbackState,
              currentPlayerId: effectiveActivePlayerId,
              playerTargets: requestTargets,
              jobId: prepJobId,
              payload: undefined
            })
          })

          if (res.status === 202) {
            console.info('[useGameData] options warming jobId=%s', prepJobId)
            setLoadingStage({ stage: 'Warming up…', progress: 70 })
            return { warming: true }
          }
          if (!res.ok) {
            const text = await res.text()
            throw new Error(text || 'Failed to fetch options')
          }
          setLoadingStage({ stage: 'Scoring options…', progress: 90 })
          const data = (await res.json()) as InitRoundResponse
          return { warming: false, data }
        }

        let optionsResult: InitRoundResponse | null = null
        const maxAttempts = 8
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const result = await fetchOptions()
          if (!result.warming) {
            optionsResult = result.data
            break
          }
          setLoadingStage({ stage: 'Warming up…', progress: 75 })
          await new Promise((resolve) => setTimeout(resolve, 300))
        }

        if (!optionsResult) {
          setLoadingStage({ stage: 'Still warming…', progress: 75 })
          setError('Engine is warming up, retrying shortly.')
          setIsBusy(false)
          return
        }

        const response = optionsResult

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
        triggerLazyUpdateTick()
        setLoadingStage({ stage: 'Ready', progress: 100 })
        setError(null)
      } catch (gameError) {
        const message =
          gameError instanceof Error
            ? gameError.message
            : 'Failed to refresh related songs.'
        console.error('[useGameData] Error:', gameError)
        setError(message)
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
      onTargetsUpdate,
      triggerLazyUpdateTick
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
