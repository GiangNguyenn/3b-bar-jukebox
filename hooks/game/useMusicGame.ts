import { useCallback, useEffect, useRef, useState } from 'react'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import type { SpotifyPlaybackState, TrackDetails } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import type { TargetArtist } from '@/services/gameService'
import {
  DEFAULT_PLAYER_GRAVITY,
  type DgsDebugInfo,
  type DgsOptionTrack,
  type DgsSelectionMeta,
  type ExplorationPhase,
  type PlayerGravityMap,
  type PlayerId,
  type PlayerTargetsMap
} from '@/services/game/dgsTypes'
import { calculateMoveCategory } from '@/services/game/gameRules'

// New Hooks
import { useGameTimer } from './useGameTimer'
import { useGameRound } from './useGameRound'
import { useGameData } from './useGameData'

interface PlayerState {
  id: PlayerId
  score: number
  targetArtist: TargetArtist | null
}

type GamePhase = 'loading' | 'selecting' | 'waiting_for_track'

interface UseMusicGameOptions {
  username?: string
}

interface ScoringPlayer {
  playerId: PlayerId
  artistName: string
}

interface UseMusicGameResult {
  players: PlayerState[]
  activePlayerId: PlayerId
  phase: GamePhase
  options: DgsOptionTrack[]
  nowPlaying: SpotifyPlaybackState | null
  isBusy: boolean
  error: string | null
  pendingSelectionTrackId: string | null
  scoringPlayer: ScoringPlayer | null
  onScoreAnimationComplete: () => void
  handleSelectOption: (option: DgsOptionTrack) => void
  updatePlayerTargetArtist: (
    playerId: PlayerId,
    artist: TargetArtist,
    isManual?: boolean
  ) => void
  resetGame: () => void
  // DGS Debug Data
  playerGravities: PlayerGravityMap
  roundTurn: number
  turnCounter: number
  explorationPhase: ExplorationPhase
  ogDrift: number
  candidatePoolSize: number
  hardConvergenceActive: boolean
  vicinity: { triggered: boolean; playerId?: PlayerId }
  debugInfo?: DgsDebugInfo
  // Turn timer
  turnTimeRemaining: number
  turnTimerActive: boolean
  turnExpired: boolean
  isWaitingForFirstTrack: boolean
}

const STORAGE_KEY_TARGET_ARTISTS = 'music-game-target-artists'

// Helper to save target artists to localStorage
function saveTargetArtistsToStorage(targets: PlayerTargetsMap): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY_TARGET_ARTISTS, JSON.stringify(targets))
  } catch {
    // Ignore storage errors
  }
}

export function useMusicGame({
  username
}: UseMusicGameOptions = {}): UseMusicGameResult {
  // --- Core State ---
  const [players, setPlayers] = useState<PlayerState[]>([
    { id: 'player1', score: 0, targetArtist: null },
    { id: 'player2', score: 0, targetArtist: null }
  ])
  const [activePlayerId, setActivePlayerId] = useState<PlayerId>('player1')
  const [phase, setPhase] = useState<GamePhase>('loading')
  const [playerGravities, setPlayerGravities] = useState<PlayerGravityMap>({
    player1: DEFAULT_PLAYER_GRAVITY,
    player2: DEFAULT_PLAYER_GRAVITY
  })

  // Selection / Scoring State
  const [pendingSelectionTrackId, setPendingSelectionTrackId] = useState<
    string | null
  >(null)
  const [playedTrackIds, setPlayedTrackIds] = useState<string[]>([])
  const [scoringPlayer, setScoringPlayer] = useState<ScoringPlayer | null>(null)
  const scoreAnimationCompleteRef = useRef(false)
  const isManualTargetChangeRef = useRef(false)

  // Initialization State
  const hasInitializedRef = useRef(false)
  const lastTrackIdRef = useRef<string | null>(null)
  const [isWaitingForFirstTrack, setIsWaitingForFirstTrack] = useState(false)

  // Optimistic UI updates refs
  const gravityUpdateTrackIdRef = useRef<string | null>(null)
  const pendingSelectionMetaRef = useRef<DgsSelectionMeta | null>(null)

  // --- Composed Hooks ---

  const {
    roundTurn,
    turnCounter,
    explorationPhase,
    ogDrift,
    hardConvergenceActive,
    incrementTurn,
    reset: resetRound,
    roundTurnRef,
    turnCounterRef
  } = useGameRound()

  const {
    timeRemaining: turnTimeRemaining,
    isExpired: turnExpired,
    reset: resetTimer
  } = useGameTimer({
    isActive: phase === 'selecting' && !pendingSelectionTrackId
  })

  // Callback to update local gravities from data hook
  const handleGravitiesUpdate = useCallback(
    (newGravities: PlayerGravityMap) => {
      setPlayerGravities(newGravities)
    },
    []
  )

  // Callback to update targets from data hook or manual
  const applyPlayerTargets = useCallback(
    (targets?: PlayerTargetsMap, fallback?: TargetArtist[]) => {
      if (!targets && !fallback) {
        return
      }
      const fallbackTargets = fallback ?? []
      setPlayers((prev) =>
        prev.map((player, index) => ({
          ...player,
          targetArtist:
            targets?.[player.id] ??
            fallbackTargets[index] ??
            player.targetArtist
        }))
      )
    },
    []
  )

  const {
    options,
    isBusy,
    error: dataError, // Renamed to avoid confusion with overall error state
    candidatePoolSize,
    vicinity,
    debugInfo,
    refreshOptions,
    lastSeedTrackIdRef,
    lastCompletedSelectionRef,
    clearOptions
  } = useGameData({
    activePlayerId,
    players,
    playedTrackIds,
    playerGravities,
    roundTurn,
    turnCounter,
    onGravitiesUpdate: handleGravitiesUpdate,
    onTargetsUpdate: applyPlayerTargets
  })

  // Local error state (merges data error + logic errors)
  const [localError, setLocalError] = useState<string | null>(null)
  const error = localError || dataError

  // --- Side Effects ---

  // Persist target artists
  useEffect(() => {
    const targets: PlayerTargetsMap = {
      player1: players.find((p) => p.id === 'player1')?.targetArtist ?? null,
      player2: players.find((p) => p.id === 'player2')?.targetArtist ?? null
    }
    saveTargetArtistsToStorage(targets)
  }, [players])

  // Poll Now Playing
  const {
    data: nowPlaying,
    error: nowPlayingError,
    isLoading: isNowPlayingLoading
  } = useNowPlayingTrack({
    token: null,
    enabled: true,
    refetchInterval: 15000
  })

  // --- Game Flow Logic ---

  const updatePlayerTargetArtist = useCallback(
    (playerId: PlayerId, artist: TargetArtist, isManual = false) => {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId ? { ...p, targetArtist: artist } : p
        )
      )

      if (isManual) {
        isManualTargetChangeRef.current = true
        resetRound()
        setPlayerGravities({
          player1: DEFAULT_PLAYER_GRAVITY,
          player2: DEFAULT_PLAYER_GRAVITY
        })
        clearOptions()

        // Slight delay to allow state to settle before refreshing options
        // We pass the new target immediately to refreshOptions via override
        const overrideTargets = {
          player1:
            players.find((p) => p.id === 'player1')?.targetArtist ?? null,
          player2:
            players.find((p) => p.id === 'player2')?.targetArtist ?? null,
          [playerId]: artist // Ensure the newest change is included
        }

        // If we have a playing track, refresh options for the new target
        if (nowPlaying) {
          void refreshOptions(nowPlaying, overrideTargets, true) // skipTargetUpdate=true to keep our manual change
          isManualTargetChangeRef.current = false
        }
      }
    },
    [players, resetRound, clearOptions, nowPlaying, refreshOptions]
  )

  const resetGame = useCallback(() => {
    resetRound()
    setPlayerGravities({
      player1: DEFAULT_PLAYER_GRAVITY,
      player2: DEFAULT_PLAYER_GRAVITY
    })
    setPlayers((prev) =>
      prev.map((player) => ({
        ...player,
        targetArtist: null
      }))
    )
    lastCompletedSelectionRef.current = null
    pendingSelectionMetaRef.current = null
    gravityUpdateTrackIdRef.current = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_TARGET_ARTISTS)
    }
  }, [resetRound])

  // --- Track Change & Initialization Handling ---

  useEffect(() => {
    if (isNowPlayingLoading) {
      if (!hasInitializedRef.current) setPhase('loading')
      return
    }

    if (nowPlayingError) {
      setLocalError('Unable to load currently playing track.')
      if (!hasInitializedRef.current) setPhase('loading')
      return
    }

    if (!nowPlaying?.item?.artists?.length || !nowPlaying.item.artists[0]?.id) {
      setLocalError(
        nowPlaying ? 'Current track info missing.' : 'No track playing.'
      )
      if (!hasInitializedRef.current) setPhase('loading')
      return
    }

    setLocalError(null)

    // First Load / Track Change Detection
    if (!hasInitializedRef.current) {
      if (!lastTrackIdRef.current) {
        lastTrackIdRef.current = nowPlaying.item.id
        setPhase('loading')
        setIsWaitingForFirstTrack(true)
        return
      }
      if (lastTrackIdRef.current === nowPlaying.item.id) {
        setPhase('loading')
        setIsWaitingForFirstTrack(true)
        return
      }
      // Track changed!
      const p1 = players.find((p) => p.id === 'player1')?.targetArtist
      const p2 = players.find((p) => p.id === 'player2')?.targetArtist

      if (!p1?.name || !p2?.name) {
        setPhase('loading')
        setIsWaitingForFirstTrack(true)
        return
      }

      // Ready
      hasInitializedRef.current = true
      lastTrackIdRef.current = nowPlaying.item.id
      setIsWaitingForFirstTrack(false)
      void refreshOptions(nowPlaying)
      // Phase will be set to 'selecting' when options finish loading
      return
    }
  }, [
    isNowPlayingLoading,
    nowPlaying,
    nowPlayingError,
    players,
    refreshOptions
  ])

  // Track previous isBusy state to detect when loading completes
  const previousIsBusyRef = useRef(isBusy)

  // Set phase to 'selecting' and reset timer only when options finish loading
  useEffect(() => {
    const wasBusy = previousIsBusyRef.current
    const justFinishedLoading = wasBusy && !isBusy

    // Update previous busy state
    previousIsBusyRef.current = isBusy

    if (
      !isBusy &&
      hasInitializedRef.current &&
      nowPlaying &&
      options.length > 0 &&
      !scoringPlayer
    ) {
      // Set phase to selecting
      if (phase !== 'selecting') {
        setPhase('selecting')
      }

      // Reset timer only when we just finished loading new options
      if (justFinishedLoading) {
        resetTimer()
      }
    }
  }, [isBusy, nowPlaying, options.length, scoringPlayer, phase, resetTimer])

  // --- Scoring & Turn Processing ---

  useEffect(() => {
    if (!nowPlaying?.item || !hasInitializedRef.current) return
    const nowPlayingId = nowPlaying.item.id

    // Dedup processing
    if (
      nowPlayingId === lastTrackIdRef.current &&
      !isManualTargetChangeRef.current
    )
      return
    if (isManualTargetChangeRef.current) return

    lastTrackIdRef.current = nowPlayingId

    // Check if game is in progress (both players have target artists set)
    const isGameInProgress =
      players[0]?.targetArtist !== null && players[1]?.targetArtist !== null

    // Calculate next active player ID BEFORE processing (needed for refreshOptions)
    const nextActivePlayerId: PlayerId =
      activePlayerId === 'player1' ? 'player2' : 'player1'

    // Switch active player immediately if game is in progress
    // This ensures refreshOptions uses the correct player for the next turn
    if (isGameInProgress) {
      setActivePlayerId(nextActivePlayerId)
    }

    // Prevent re-processing played tracks, BUT ensure we still refresh options
    // The original code:
    /*
      if (playedTrackIds.includes(nowPlayingId)) {
          void refreshOptions(nowPlaying)
          return
      }
    */
    // We should maintain this behavior.
    if (playedTrackIds.includes(nowPlayingId)) {
      // Use next active player ID if game is in progress
      void refreshOptions(
        nowPlaying,
        undefined,
        false,
        undefined,
        isGameInProgress ? nextActivePlayerId : undefined
      )
      return
    }

    // Was this selected by a player?
    const wasPlayerSelected = pendingSelectionTrackId === nowPlayingId

    // Clear pending if mismatch (skipped track/error)
    if (pendingSelectionTrackId && !wasPlayerSelected) {
      setPendingSelectionTrackId(null)
      pendingSelectionMetaRef.current = null
    }

    // Score Check
    const trackArtistNames = new Set(
      nowPlaying.item.artists
        .map((a) => a.name?.trim().toLowerCase())
        .filter(Boolean) as string[]
    )
    const normalize = (s: string) => s.trim().toLowerCase()

    const scoringPlayers: ScoringPlayer[] = []
    let didScore = false

    const newPlayers = players.map((player) => {
      const target = player.targetArtist
      if (!target?.name) return player

      if (trackArtistNames.has(normalize(target.name))) {
        scoringPlayers.push({ playerId: player.id, artistName: target.name })
        didScore = true
        return { ...player, score: player.score + 1 }
      }
      return player
    })

    if (didScore) {
      setPlayers(newPlayers)
    }

    // Mark as played
    setPlayedTrackIds((prev) =>
      prev.includes(nowPlayingId) ? prev : [...prev, nowPlayingId]
    )

    // Update Round/Turn logic if player selected it
    if (wasPlayerSelected) {
      setPendingSelectionTrackId(null)

      const selectionMeta: DgsSelectionMeta =
        pendingSelectionMetaRef.current &&
        pendingSelectionMetaRef.current.trackId === nowPlayingId
          ? pendingSelectionMetaRef.current
          : {
              trackId: nowPlayingId,
              playerId: activePlayerId, // Fallback, likely inaccuracy if pendingSelectionMeta is lost
              previousTrackId: lastSeedTrackIdRef.current
            }

      if (gravityUpdateTrackIdRef.current === nowPlayingId) {
        // Already updated gravity optimistically
        lastCompletedSelectionRef.current = null
        gravityUpdateTrackIdRef.current = null
      } else {
        lastCompletedSelectionRef.current = selectionMeta
      }

      pendingSelectionMetaRef.current = null

      // Progress game round
      incrementTurn(true) // true = continue round
    }

    // Note: Active player switch happens at the top of this effect if game is in progress
    // This ensures the correct player is used when loading related songs

    // Handle Scoring Animation / Pause
    if (didScore && scoringPlayers.length > 0) {
      setScoringPlayer(scoringPlayers[0])
      scoreAnimationCompleteRef.current = false
      // Pauses here until animation clears scoringPlayer
      return
    }

    // Set phase to waiting while options load (timer will start when options are ready)
    setPhase('waiting_for_track')
    // Use next active player ID if game is in progress to ensure correct target artist is used
    void refreshOptions(
      nowPlaying,
      undefined,
      false,
      undefined,
      isGameInProgress ? nextActivePlayerId : undefined
    )
  }, [
    nowPlaying,
    pendingSelectionTrackId,
    activePlayerId,
    players,
    playedTrackIds,
    refreshOptions,
    incrementTurn
  ])

  // --- Handlers ---

  const handleSelectOption = useCallback(
    async (option: DgsOptionTrack) => {
      if (!username) {
        setLocalError('Username is required')
        return
      }
      if (turnExpired) {
        setLocalError('Time expired!')
        return
      }
      if (!option || phase !== 'selecting') return

      setLocalError(null)

      const track = option.track

      const currentPlayerAttraction =
        activePlayerId === 'player1'
          ? option.metrics.aAttraction
          : option.metrics.bAttraction
      const baseline = option.metrics.currentSongAttraction

      const selectionCategory = calculateMoveCategory(
        currentPlayerAttraction,
        baseline
      )

      // Optimistic Update
      const meta = {
        trackId: track.id,
        playerId: activePlayerId,
        previousTrackId: lastSeedTrackIdRef.current,
        selectionCategory
      }
      pendingSelectionMetaRef.current = meta
      setPendingSelectionTrackId(track.id)

      try {
        // Queue track
        await sendApiRequest<void>({
          path: `/playlist/${username}`,
          method: 'POST',
          isLocalApi: true,
          body: {
            tracks: {
              id: track.id,
              name: track.name,
              artists: track.artists.map((a) => ({ name: a.name })),
              album: { name: track.album.name },
              duration_ms: track.duration_ms,
              popularity: track.popularity,
              uri: track.uri
            },
            initialVotes: 50,
            source: 'system'
          }
        })

        // Influence update
        try {
          const influenceResponse = await sendApiRequest<{
            gravities: PlayerGravityMap
          }>({
            path: '/game/influence',
            method: 'POST',
            isLocalApi: true,
            body: { playerGravities, lastSelection: meta }
          })
          if (influenceResponse.gravities) {
            setPlayerGravities(influenceResponse.gravities)
            gravityUpdateTrackIdRef.current = track.id
          }
        } catch (e) {
          console.error('Influence update failed', e)
        }

        setPhase('waiting_for_track')
      } catch (e) {
        setLocalError('Failed to queue track')
        setPendingSelectionTrackId(null)
        pendingSelectionMetaRef.current = null
      }
    },
    [
      username,
      turnExpired,
      phase,
      activePlayerId,
      playerGravities,
      lastSeedTrackIdRef
    ]
  )

  const onScoreAnimationComplete = useCallback(() => {
    const wasScoring = scoringPlayer !== null
    setScoringPlayer(null)
    scoreAnimationCompleteRef.current = true

    if (wasScoring) {
      // Round Reset on score
      resetRound()
      // Reset gravities
      setPlayerGravities({
        player1: DEFAULT_PLAYER_GRAVITY,
        player2: DEFAULT_PLAYER_GRAVITY
      })
      // Reset target artists to trigger new assignment
      setPlayers((prev) =>
        prev.map((player) => ({
          ...player,
          targetArtist: null
        }))
      )
      clearOptions()
      // Active player was already switched when the selection was made

      // Refresh options with clean slate, null target artists, and reset gravities
      if (nowPlaying) {
        void refreshOptions(
          nowPlaying,
          { player1: null, player2: null },
          false,
          [],
          undefined,
          {
            player1: DEFAULT_PLAYER_GRAVITY,
            player2: DEFAULT_PLAYER_GRAVITY
          }
        )
      }
    }
  }, [scoringPlayer, resetRound, clearOptions, nowPlaying, refreshOptions])

  return {
    players,
    activePlayerId,
    phase,
    options,
    nowPlaying,
    isBusy,
    error,
    pendingSelectionTrackId,
    scoringPlayer,
    onScoreAnimationComplete,
    handleSelectOption,
    updatePlayerTargetArtist,
    resetGame,
    playerGravities,
    roundTurn,
    turnCounter,
    explorationPhase,
    ogDrift,
    candidatePoolSize,
    hardConvergenceActive,
    vicinity,
    debugInfo,
    turnTimeRemaining,
    turnTimerActive: phase === 'selecting' && !pendingSelectionTrackId,
    turnExpired,
    isWaitingForFirstTrack
  }
}
