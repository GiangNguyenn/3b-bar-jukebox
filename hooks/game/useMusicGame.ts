import { useCallback, useEffect, useRef, useState } from 'react'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import type { SpotifyPlaybackState, TrackDetails } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import type { GameOptionTrack, TargetArtist } from '@/services/gameService'
import { chooseTargetArtists } from '@/services/gameService'

type PlayerId = 'player1' | 'player2'

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
  options: GameOptionTrack[]
  nowPlaying: SpotifyPlaybackState | null
  isBusy: boolean
  error: string | null
  pendingSelectionTrackId: string | null
  scoringPlayer: ScoringPlayer | null
  onScoreAnimationComplete: () => void
  handleSelectOption: (option: GameOptionTrack) => void
  updatePlayerTargetArtist: (playerId: PlayerId, artist: TargetArtist) => void
  resetGame: () => void
}

export function useMusicGame({
  username
}: UseMusicGameOptions = {}): UseMusicGameResult {
  const [players, setPlayers] = useState<PlayerState[]>([
    { id: 'player1', score: 0, targetArtist: null },
    { id: 'player2', score: 0, targetArtist: null }
  ])
  const [activePlayerId, setActivePlayerId] = useState<PlayerId>('player1')
  const [phase, setPhase] = useState<GamePhase>('loading')
  const [options, setOptions] = useState<GameOptionTrack[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [pendingSelectionTrackId, setPendingSelectionTrackId] = useState<
    string | null
  >(null)
  const [playedTrackIds, setPlayedTrackIds] = useState<string[]>([])
  const [scoringPlayer, setScoringPlayer] = useState<ScoringPlayer | null>(null)
  const hasInitializedRef = useRef(false)
  const scoreAnimationCompleteRef = useRef(false)
  const lastTrackIdRef = useRef<string | null>(null)

  const {
    data: nowPlaying,
    error: nowPlayingError,
    isLoading: isNowPlayingLoading
  } = useNowPlayingTrack({
    token: null,
    enabled: true,
    refetchInterval: 8000
  })

  const refreshTargetArtists = useCallback(() => {
    // Always assign new random target artists (overwrites any manual selections)
    const newTargets = chooseTargetArtists()

    setPlayers((prev) =>
      prev.map((player, index) => ({
        ...player,
        targetArtist: newTargets[index] ?? null
      }))
    )
  }, [])

  const refreshOptions = useCallback(
    async (playbackState: SpotifyPlaybackState | null) => {
      if (!playbackState) return

      // Clear options immediately to show loading state
      setOptions([])
      setPhase('loading')
      setIsBusy(true)
      setError(null)

      try {
        const response = await sendApiRequest<{
          targetArtists: TargetArtist[]
          optionTracks: GameOptionTrack[]
        }>({
          path: '/game/init-round',
          method: 'POST',
          isLocalApi: true,
          body: { playbackState }
        })

        const excludedIds = new Set<string>(
          [playbackState.item?.id ?? '', ...playedTrackIds].filter(Boolean)
        )

        const filteredOptions = response.optionTracks.filter(
          (opt) => opt.track && !excludedIds.has(opt.track.id)
        )

        setOptions(filteredOptions)
        setPhase('selecting')
      } catch (gameError) {
        const message =
          gameError instanceof Error
            ? gameError.message
            : 'Failed to refresh related songs.'
        setError(message)
        setOptions([])
      } finally {
        setIsBusy(false)
      }
    },
    [playedTrackIds]
  )

  const initializeRound = useCallback(
    async (playbackState: SpotifyPlaybackState | null) => {
      if (!playbackState) return

      setIsBusy(true)
      setError(null)

      try {
        // Call server-side API to initialize the round
        const response = await sendApiRequest<{
          targetArtists: TargetArtist[]
          optionTracks: GameOptionTrack[]
        }>({
          path: '/game/init-round',
          method: 'POST',
          isLocalApi: true,
          body: { playbackState }
        })

        const { targetArtists, optionTracks } = response

        // Update players with new target artists (always assign, even if manually set)
        setPlayers((prev) =>
          prev.map((player, index) => ({
            ...player,
            targetArtist: targetArtists[index] ?? null
          }))
        )

        const excludedIds = new Set<string>(
          [playbackState.item?.id ?? '', ...playedTrackIds].filter(Boolean)
        )

        const filteredOptions = optionTracks.filter(
          (opt) => opt.track && !excludedIds.has(opt.track.id)
        )

        setOptions(filteredOptions)
        setPhase('selecting')
      } catch (gameError) {
        const message =
          gameError instanceof Error
            ? gameError.message
            : 'Failed to initialize game round.'
        setError(message)
        setOptions([])
        setPhase('loading')
      } finally {
        setIsBusy(false)
      }
    },
    [playedTrackIds]
  )

  useEffect(() => {
    if (isNowPlayingLoading) {
      // Only show loading state before the first successful initialization
      if (!hasInitializedRef.current) {
        setPhase('loading')
      }
      return
    }

    if (nowPlayingError) {
      setError('Unable to load currently playing track.')
      if (!hasInitializedRef.current) {
        setPhase('loading')
      }
      return
    }

    if (!nowPlaying) {
      setError('No track is currently playing.')
      if (!hasInitializedRef.current) {
        setPhase('loading')
      }
      return
    }

    // Check if the track has artists before initializing
    if (!nowPlaying.item?.artists || nowPlaying.item.artists.length === 0) {
      setError('Current track does not have artist information.')
      if (!hasInitializedRef.current) {
        setPhase('loading')
      }
      return
    }

    // Check if the first artist has an ID
    const artistId = nowPlaying.item.artists[0]?.id
    if (!artistId) {
      setError('Current track does not have a valid artist ID.')
      if (!hasInitializedRef.current) {
        setPhase('loading')
      }
      return
    }

    setError(null)

    // Only initialize the round once on initial page load
    if (hasInitializedRef.current) {
      return
    }

    hasInitializedRef.current = true
    void initializeRound(nowPlaying)
  }, [
    initializeRound,
    isNowPlayingLoading,
    nowPlaying,
    nowPlayingError,
    pendingSelectionTrackId
  ])

  // Check for scoring and refresh options whenever the track changes
  useEffect(() => {
    if (!nowPlaying?.item || !hasInitializedRef.current) {
      return
    }

    const nowPlayingId = nowPlaying.item.id

    // Skip if this is the same track we already processed
    if (nowPlayingId === lastTrackIdRef.current) {
      return
    }

    // Update last track ID
    lastTrackIdRef.current = nowPlayingId

    // Skip if this track was already played (to avoid duplicate processing)
    if (playedTrackIds.includes(nowPlayingId)) {
      // Still refresh options even if track was already played
      void refreshOptions(nowPlaying)
      return
    }

    // If we were waiting for a specific track but a different one started playing,
    // clear the pending selection (something went wrong or track was skipped)
    const wasPlayerSelected = pendingSelectionTrackId === nowPlayingId
    if (pendingSelectionTrackId && !wasPlayerSelected) {
      setPendingSelectionTrackId(null)
    }

    const targetsById = players.reduce<Record<PlayerId, TargetArtist | null>>(
      (acc, player) => {
        acc[player.id] = player.targetArtist ?? null
        return acc
      },
      {
        player1: null,
        player2: null
      }
    )

    // Get ALL artist names from the currently playing track (normalized for comparison)
    const trackArtistNames = new Set(
      nowPlaying.item.artists
        .map((artist) => artist.name?.trim().toLowerCase())
        .filter((name): name is string => Boolean(name))
    )

    // Helper function to normalize artist names for comparison
    const normalizeArtistName = (name: string): string => {
      return name.trim().toLowerCase()
    }

    // Find which players scored by checking if their target artist name matches any track artist
    const scoringPlayers: ScoringPlayer[] = []
    const didAnyScore = players.some((player) => {
      const target = targetsById[player.id]
      if (!target || !target.name) {
        return false
      }

      const normalizedTargetName = normalizeArtistName(target.name)
      const hasMatch = trackArtistNames.has(normalizedTargetName)

      if (hasMatch) {
        scoringPlayers.push({
          playerId: player.id,
          artistName: target.name
        })
      }

      return hasMatch
    })

    // Update scores
    setPlayers((prev) =>
      prev.map((player) => {
        const target = targetsById[player.id]
        if (!target || !target.name) {
          return player
        }

        const normalizedTargetName = normalizeArtistName(target.name)
        const hasMatch = trackArtistNames.has(normalizedTargetName)

        if (!hasMatch) {
          return player
        }

        return {
          ...player,
          score: player.score + 1
        }
      })
    )

    // Mark the now playing track as played so it never appears as a future option
    setPlayedTrackIds((prev) =>
      prev.includes(nowPlayingId) ? prev : [...prev, nowPlayingId]
    )

    // Clear pending selection if this was the selected track
    if (wasPlayerSelected) {
      setPendingSelectionTrackId(null)
    }

    // If any player scored, show animation and delay continuation
    if (didAnyScore && scoringPlayers.length > 0) {
      // Show animation for the first scoring player (or both if they both scored)
      setScoringPlayer(scoringPlayers[0])
      scoreAnimationCompleteRef.current = false

      // Don't continue game until animation completes
      return
    }

    // No score - continue immediately
    // Only switch players if this was a player-selected track
    if (wasPlayerSelected) {
      const nextPlayerId: PlayerId =
        activePlayerId === 'player1' ? 'player2' : 'player1'
      setActivePlayerId(nextPlayerId)
    }

    // Always refresh related songs for the new now-playing track
    void refreshOptions(nowPlaying)
  }, [
    activePlayerId,
    nowPlaying,
    pendingSelectionTrackId,
    players,
    playedTrackIds,
    refreshOptions,
    refreshTargetArtists
  ])

  const handleSelectOption = useCallback(
    async (option: GameOptionTrack) => {
      if (!username || !option || phase !== 'selecting') {
        return
      }

      setIsBusy(true)
      setError(null)

      try {
        const track: TrackDetails = option.track

        await sendApiRequest<void>({
          path: `/playlist/${username}`,
          method: 'POST',
          isLocalApi: true,
          body: {
            tracks: {
              id: track.id,
              name: track.name,
              artists: track.artists.map((artist) => ({ name: artist.name })),
              album: { name: track.album.name },
              duration_ms: track.duration_ms,
              popularity: track.popularity,
              uri: track.uri
            },
            initialVotes: 50,
            source: 'system'
          }
        })

        setPendingSelectionTrackId(track.id)
        setPhase('waiting_for_track')
      } catch (selectionError) {
        const message =
          selectionError instanceof Error
            ? selectionError.message
            : 'Failed to queue selected track.'
        setError(message)
        setPhase('selecting')
      } finally {
        setIsBusy(false)
      }
    },
    [phase, username]
  )

  const onScoreAnimationComplete = useCallback(() => {
    setScoringPlayer(null)
    scoreAnimationCompleteRef.current = true

    // Now continue with game logic
    if (nowPlaying) {
      const nextPlayerId: PlayerId =
        activePlayerId === 'player1' ? 'player2' : 'player1'
      setActivePlayerId(nextPlayerId)
      void refreshOptions(nowPlaying)

      // Refresh target artists after scoring
      refreshTargetArtists()
    }
  }, [activePlayerId, nowPlaying, refreshOptions, refreshTargetArtists])

  const updatePlayerTargetArtist = useCallback(
    (playerId: PlayerId, artist: TargetArtist) => {
      setPlayers((prev) =>
        prev.map((player) =>
          player.id === playerId ? { ...player, targetArtist: artist } : player
        )
      )
    },
    []
  )

  const resetGame = useCallback(() => {
    setPlayers([
      { id: 'player1', score: 0, targetArtist: null },
      { id: 'player2', score: 0, targetArtist: null }
    ])
    setActivePlayerId('player1')
    setScoringPlayer(null)
    setOptions([])
    setError(null)
    setPendingSelectionTrackId(null)
    setPhase('loading')

    if (nowPlaying) {
      void initializeRound(nowPlaying)
    }
  }, [initializeRound, nowPlaying])

  return {
    players,
    activePlayerId,
    phase,
    options,
    nowPlaying: nowPlaying ?? null,
    isBusy,
    error,
    pendingSelectionTrackId,
    scoringPlayer,
    onScoreAnimationComplete,
    handleSelectOption,
    updatePlayerTargetArtist,
    resetGame
  }
}
