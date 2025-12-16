'use client'

import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { getCardFeedback as getCardFeedbackRule } from '@/services/game/gameRules'
import type { DgsOptionTrack, GamePlayer } from '@/services/game/dgsTypes'
import { GameOptionNode } from './GameOptionNode'
import { GameOptionSkeleton } from './GameOptionSkeleton'
import { useState, useEffect, useRef, useMemo } from 'react'
import type { TargetArtist } from '@/services/gameService'
import { PlayerHud } from './PlayerHud'
import { TurnTimer } from './TurnTimer'
import { useTrackGenre } from '@/hooks/useTrackGenre'
import { shuffleArray } from '@/lib/utils'

export type GamePhase = 'loading' | 'selecting' | 'waiting_for_track'
export type PlayerId = 'player1' | 'player2'

export interface GameBoardProps {
  nowPlaying: SpotifyPlaybackState | null
  options: DgsOptionTrack[]

  gameState: {
    phase: GamePhase
    roundTurn: number
    turnExpired: boolean
    turnTimeRemaining: number
    turnTimerActive: boolean
    isWaitingForFirstTrack: boolean
    pendingSelectionTrackId: string | null
    difficulty: 'easy' | 'medium' | 'hard'
  }

  playerState: {
    players: GamePlayer[]
    names: Record<PlayerId, string>
    gravities: Record<PlayerId, number>
    activeId: PlayerId
    targetArtists: TargetArtist[]
  }

  callbacks: {
    onSelectOption: (option: DgsOptionTrack) => void
    onDifficultyChange: (difficulty: 'easy' | 'medium' | 'hard') => void
    onTargetArtistChange: (playerId: PlayerId, artist: TargetArtist) => void
    onPlayerNameChange: (playerId: PlayerId, name: string) => void
  }
}

export function GameBoard({
  nowPlaying,
  options,
  gameState,
  playerState,
  callbacks
}: GameBoardProps): JSX.Element {
  const currentTrack = nowPlaying?.item
  const [feedbackForPlayer, setFeedbackForPlayer] = useState<PlayerId | null>(
    null
  )
  const feedbackRoundRef = useRef<number | null>(null)

  // Custom hook for genre
  const { genre: currentTrackGenre } = useTrackGenre(currentTrack?.id)

  const isSelecting =
    gameState.phase === 'selecting' &&
    !gameState.turnExpired &&
    !gameState.pendingSelectionTrackId &&
    !feedbackForPlayer

  // Show feedback after a selection is made, keep it visible until new options arrive
  useEffect(() => {
    if (gameState.pendingSelectionTrackId !== null) {
      // Selection made - show feedback for active player and track the round
      setFeedbackForPlayer(playerState.activeId)
      feedbackRoundRef.current = gameState.roundTurn
    } else if (
      feedbackForPlayer !== null &&
      feedbackRoundRef.current !== null
    ) {
      if (gameState.roundTurn !== feedbackRoundRef.current) {
        setFeedbackForPlayer(null)
        feedbackRoundRef.current = null
      }
    }
  }, [
    gameState.pendingSelectionTrackId,
    playerState.activeId,
    gameState.roundTurn,
    feedbackForPlayer
  ])

  // Clear feedback when options *content* changes significantly (e.g. new round)
  const optionsIdHash = options
    .map((o) => o.track.id)
    .sort()
    .join(',')
  const prevOptionsRef = useRef<string>(optionsIdHash)

  useEffect(() => {
    if (prevOptionsRef.current !== optionsIdHash) {
      if (feedbackForPlayer) {
        setFeedbackForPlayer(null)
      }
      prevOptionsRef.current = optionsIdHash
    }
  }, [optionsIdHash, feedbackForPlayer])

  // Shuffle options for random display order (Fisher-Yates algorithm)
  const shuffledOptions = useMemo(() => {
    const visible = currentTrack?.id
      ? options.filter((option) => option.track.id !== currentTrack.id)
      : options

    return shuffleArray(visible)
  }, [options, currentTrack?.id])

  // Helper to determine feedback for each card based on comparison to current song
  const getCardFeedback = (
    option: DgsOptionTrack
  ): 'closer' | 'neutral' | 'further' | undefined => {
    if (!feedbackForPlayer) return undefined
    return getCardFeedbackRule(option, feedbackForPlayer)
  }

  return (
    <div className='mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6'>
      {/* SECTION 1: NOW PLAYING */}
      <div className='w-full'>
        <div className='relative flex flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-black to-gray-900 p-5 shadow-lg'>
          <div className='pointer-events-none absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5' />
          <h1 className='relative z-10 mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-xl font-bold tracking-tight text-transparent'>
            Music Connections (Beta)
          </h1>
          <p className='relative z-10 text-xs font-semibold uppercase tracking-wide text-gray-500'>
            Now Playing
          </p>
          {currentTrack ? (
            <>
              <h2 className='text-white mt-2 text-2xl font-bold'>
                {currentTrack.name}
              </h2>
              <p className='mt-1 text-sm text-gray-300'>
                {currentTrack.artists[0]?.name ?? 'Unknown Artist'}
              </p>
              <p className='mt-1 text-xs text-gray-500'>
                {currentTrack.album?.name ?? 'Unknown Album'}
              </p>
              {currentTrackGenre && (
                <p className='mt-1 text-xs text-gray-400'>
                  Genre:{' '}
                  <span className='text-gray-300'>{currentTrackGenre}</span>
                </p>
              )}
              <p className='mt-4 text-xs leading-relaxed text-gray-400'>
                <span className='font-semibold text-gray-300'>
                  How to Play:
                </span>{' '}
                You have{' '}
                <span className='font-semibold text-yellow-300'>
                  60 seconds
                </span>{' '}
                to pick a song. Choose songs that move you{' '}
                <span className='font-semibold text-green-300'>closer</span> to
                your target artist to increase your influence. When your target
                artist plays, you{' '}
                <span className='font-semibold text-blue-300'>
                  score a point
                </span>
                !
              </p>

              {/* Turn Timer */}
              {(gameState.turnTimerActive ||
                (gameState.turnExpired &&
                  !gameState.pendingSelectionTrackId)) && (
                <div className='mt-4 flex flex-col items-center gap-2 border-t border-gray-800 pt-4'>
                  <TurnTimer
                    timeRemaining={gameState.turnTimeRemaining}
                    isActive={
                      gameState.turnTimerActive || gameState.turnExpired
                    }
                    isExpired={gameState.turnExpired}
                  />
                  {gameState.turnExpired && (
                    <p className='animate-pulse text-center text-[10px] text-red-400'>
                      Wait for next song
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className='mt-4 text-sm text-gray-400'>
              No track is currently playing. Start playback to begin the game.
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: PLAYER HUDS */}
      <div className='grid w-full grid-cols-2 gap-3'>
        {playerState.players.map((player) => (
          <PlayerHud
            key={player.id}
            id={player.id as PlayerId}
            label={playerState.names[player.id as PlayerId]}
            score={player.score}
            targetArtist={player.targetArtist}
            isActive={player.id === playerState.activeId}
            isSelecting={gameState.phase === 'selecting'}
            gravity={playerState.gravities[player.id as PlayerId]}
            onTargetArtistChange={
              callbacks.onTargetArtistChange
                ? (artist) =>
                    callbacks.onTargetArtistChange(
                      player.id as PlayerId,
                      artist
                    )
                : undefined
            }
            onLabelChange={
              callbacks.onPlayerNameChange
                ? (name) =>
                    callbacks.onPlayerNameChange(player.id as PlayerId, name)
                : undefined
            }
            availableArtists={playerState.targetArtists}
          />
        ))}
      </div>

      {/* SECTION 3: RELATED SONGS */}
      <div className='w-full'>
        <div className='flex h-full flex-col rounded-2xl border border-gray-800 bg-gray-950/80 p-4 shadow-lg'>
          <div className='flex items-center justify-between'>
            <p className='text-xs font-semibold uppercase tracking-wide text-gray-500'>
              Related Songs
            </p>
            <span className='text-[11px] text-gray-500'>
              {gameState.phase === 'waiting_for_track'
                ? 'Waiting for selected song to start...'
                : 'Choose one song to queue next'}
            </span>
            {/* Difficulty Toggle */}
            <div className='flex items-center gap-1 rounded-lg bg-gray-900/50 p-1'>
              {[
                { id: 'easy', label: 'Easy' },
                { id: 'medium', label: 'Med' },
                { id: 'hard', label: 'Hard' }
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() =>
                    callbacks.onDifficultyChange(
                      mode.id as 'easy' | 'medium' | 'hard'
                    )
                  }
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                    gameState.difficulty === mode.id
                      ? 'text-white bg-gray-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {gameState.isWaitingForFirstTrack ? (
              // Show waiting message
              <div className='col-span-full flex flex-col items-center justify-center py-12'>
                <div className='max-w-md rounded-lg border border-blue-500/30 bg-blue-950/20 p-6 text-center'>
                  <div className='mb-4 flex justify-center'>
                    <div className='h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent' />
                  </div>
                  <h3 className='text-lg font-semibold text-blue-300'>
                    Ready to Start!
                  </h3>
                  <p className='mt-2 text-sm text-blue-200'>
                    Waiting for the next song to begin the game...
                  </p>
                </div>
              </div>
            ) : gameState.phase === 'loading' &&
              shuffledOptions.length === 0 ? (
              // Show skeleton cards while loading
              Array.from({ length: 6 }).map((_, index) => (
                <GameOptionSkeleton key={`skeleton-${index}`} />
              ))
            ) : shuffledOptions.length > 0 ? (
              shuffledOptions.map((option) => {
                const isQueued =
                  option.track.id === gameState.pendingSelectionTrackId
                const cardFeedback = getCardFeedback(option)
                const isSelectedTrack =
                  option.track.id === gameState.pendingSelectionTrackId &&
                  feedbackForPlayer !== null

                return (
                  <GameOptionNode
                    key={`${option.track.id}-${gameState.roundTurn}`}
                    option={option}
                    disabled={!isSelecting}
                    isQueued={isQueued}
                    onSelect={callbacks.onSelectOption}
                    feedbackResult={cardFeedback}
                    isSelected={isSelectedTrack}
                    difficulty={gameState.difficulty}
                  />
                )
              })
            ) : (
              <p className='col-span-full mt-4 text-sm text-gray-500'>
                No related songs available for this track yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
