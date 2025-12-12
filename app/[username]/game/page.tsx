'use client'

import type { JSX } from 'react'
import React from 'react'
import { useParams } from 'next/navigation'
import { useMusicGame } from '@/hooks/game/useMusicGame'
import { usePlayerNames } from '@/hooks/game/usePlayerNames'
import { usePopularArtists } from '@/hooks/game/usePopularArtists'
import type { TargetArtist } from '@/services/gameService'

import { GameBoard } from './components/GameBoard'
import { ScoreAnimation } from './components/ScoreAnimation'
import { DgsDebugPanel } from './components/DgsDebugPanel'
import { LoadingProgressBar } from './components/LoadingProgressBar'
import { Loading, ErrorMessage } from '@/components/ui'

export default function GamePage(): JSX.Element {
  const params = useParams()
  const username = typeof params?.username === 'string' ? params.username : ''

  const { playerNames, updatePlayerName } = usePlayerNames()

  const handlePlayerNameChange = (
    playerId: 'player1' | 'player2',
    name: string
  ): void => {
    updatePlayerName(playerId, name)
  }

  const {
    artists: availableArtists,
    isLoading: isLoadingArtists,
    error: artistsError
  } = usePopularArtists()

  const {
    players,
    activePlayerId,
    phase,
    options,
    nowPlaying,
    isBusy,
    loadingStage,
    error,
    pendingSelectionTrackId,
    scoringPlayer,
    onScoreAnimationComplete,
    handleSelectOption,
    updatePlayerTargetArtist,
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
    turnTimerActive,
    turnExpired,
    isWaitingForFirstTrack
  } = useMusicGame({ username })

  // Track if we've done initial assignment and if targets were recently reset
  const hasAutoAssignedRef = React.useRef(false)
  const previousTargetsRef = React.useRef<{
    player1: TargetArtist | null
    player2: TargetArtist | null
  }>({
    player1: null,
    player2: null
  })

  React.useEffect(() => {
    const currentTargets = {
      player1: players[0]?.targetArtist ?? null,
      player2: players[1]?.targetArtist ?? null
    }

    // Check if targets were reset (previously had values, now null)
    const targetsWereReset =
      previousTargetsRef.current.player1 !== null &&
      previousTargetsRef.current.player2 !== null &&
      currentTargets.player1 === null &&
      currentTargets.player2 === null

    // Update previous targets
    previousTargetsRef.current = currentTargets

    // Auto-assign if: initial load OR targets were reset after scoring
    const shouldAssign =
      (!hasAutoAssignedRef.current &&
        currentTargets.player1 === null &&
        currentTargets.player2 === null) ||
      (targetsWereReset && availableArtists.length >= 2)

    if (shouldAssign && availableArtists.length >= 2 && !isLoadingArtists) {
      // Mark as assigned for initial load, but allow re-assignment after reset
      if (!hasAutoAssignedRef.current) {
        hasAutoAssignedRef.current = true
      }

      // Shuffle artists and pick first two
      const shuffled = [...availableArtists].sort(() => Math.random() - 0.5)
      const artist1 = shuffled[0]
      const artist2 = shuffled[1]

      if (artist1 && artist2) {
        // Use isManual: false (default) for auto-assignment
        updatePlayerTargetArtist('player1', artist1)
        updatePlayerTargetArtist('player2', artist2)
      }
    }
  }, [availableArtists, isLoadingArtists, players, updatePlayerTargetArtist])

  // Handler for manual target artist changes
  const handleManualTargetArtistChange = React.useCallback(
    (playerId: 'player1' | 'player2', artist: TargetArtist) => {
      // Pass isManual: true to trigger round reset
      updatePlayerTargetArtist(playerId, artist, true)
    },
    [updatePlayerTargetArtist]
  )

  // State for difficulty level (Easy = Full Info, Medium = Artist Only, Hard = Title Only)
  const [difficulty, setDifficulty] = React.useState<
    'easy' | 'medium' | 'hard'
  >('easy')

  const isInitialLoading =
    (phase === 'loading' && !nowPlaying && !error) || isLoadingArtists

  if (isInitialLoading) {
    return <Loading fullScreen message='Loading game…' />
  }

  if (artistsError) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-black'>
        <div className='w-full max-w-md px-4'>
          <ErrorMessage
            message={`Failed to load artists: ${artistsError}`}
            variant='error'
          />
        </div>
      </div>
    )
  }

  if (error && !nowPlaying) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-black'>
        <div className='w-full max-w-md px-4'>
          <ErrorMessage message={error} variant='error' />
        </div>
      </div>
    )
  }

  return (
    <div className='text-white min-h-screen bg-black selection:bg-green-500/30'>
      {/* Background Ambience */}
      <div className='pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-black to-black' />

      <div className='relative mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 md:px-6 md:py-8'>
        {error && nowPlaying && (
          <div className='rounded-lg border-2 border-red-500/50 bg-red-950/30 p-4 shadow-lg'>
            <div className='flex items-start gap-3'>
              <div className='flex-shrink-0'>
                <svg
                  className='h-6 w-6 text-red-400'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                  />
                </svg>
              </div>
              <div className='flex-1'>
                <h3 className='text-sm font-semibold text-red-300'>Error</h3>
                <p className='mt-1 text-sm text-red-200'>{error}</p>
              </div>
            </div>
          </div>
        )}

        <GameBoard
          nowPlaying={nowPlaying}
          options={options}
          phase={phase}
          pendingSelectionTrackId={pendingSelectionTrackId}
          onSelectOption={handleSelectOption}
          activePlayerId={activePlayerId}
          roundTurn={roundTurn}
          difficulty={difficulty}
          onDifficultyChange={setDifficulty}
          turnExpired={turnExpired}
          turnTimeRemaining={turnTimeRemaining}
          turnTimerActive={turnTimerActive}
          isWaitingForFirstTrack={isWaitingForFirstTrack}
          players={players}
          playerNames={playerNames}
          playerGravities={playerGravities}
          availableArtists={availableArtists}
          onTargetArtistChange={handleManualTargetArtistChange}
          onPlayerNameChange={handlePlayerNameChange}
        />

        {isBusy && (
          <LoadingProgressBar
            progress={loadingStage?.progress ?? 10}
            stage={loadingStage?.stage ?? 'Loading…'}
          />
        )}
      </div>

      <ScoreAnimation
        playerId={scoringPlayer?.playerId ?? null}
        playerLabel={
          scoringPlayer?.playerId ? playerNames[scoringPlayer.playerId] : ''
        }
        artistName={scoringPlayer?.artistName ?? null}
        onComplete={onScoreAnimationComplete}
      />

      <DgsDebugPanel
        activePlayerId={activePlayerId}
        playerGravities={playerGravities}
        roundTurn={roundTurn}
        turnCounter={turnCounter}
        explorationPhase={explorationPhase}
        ogDrift={ogDrift}
        candidatePoolSize={candidatePoolSize}
        hardConvergenceActive={hardConvergenceActive}
        vicinity={vicinity}
        players={players}
        options={options}
        debugInfo={debugInfo}
      />
    </div>
  )
}
