'use client'

import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { getCardFeedback as getCardFeedbackRule } from '@/services/game/gameRules'
import type { DgsOptionTrack, GamePlayer } from '@/services/game/dgsTypes'
import { GameOptionNode } from './GameOptionNode'
import { GameOptionSkeleton } from './GameOptionSkeleton'
import { useState, useEffect, useRef, useMemo } from 'react'

import type { TargetArtist } from '@/services/gameService'
import { PlayerHud } from './PlayerHud'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

type GamePhase = 'loading' | 'selecting' | 'waiting_for_track'
type PlayerId = 'player1' | 'player2'

interface GameBoardProps {
  nowPlaying: SpotifyPlaybackState | null
  options: DgsOptionTrack[]
  phase: GamePhase
  pendingSelectionTrackId: string | null
  onSelectOption: (option: DgsOptionTrack) => void
  activePlayerId: PlayerId
  roundTurn: number
  difficulty: 'easy' | 'medium' | 'hard'
  onDifficultyChange: (difficulty: 'easy' | 'medium' | 'hard') => void
  turnExpired: boolean
  turnTimeRemaining: number
  turnTimerActive: boolean
  isWaitingForFirstTrack: boolean

  // Player HUD props
  players: GamePlayer[]
  playerNames: Record<PlayerId, string>
  playerGravities: Record<PlayerId, number>
  availableArtists: TargetArtist[]
  onTargetArtistChange: (playerId: PlayerId, artist: TargetArtist) => void
  onPlayerNameChange: (playerId: PlayerId, name: string) => void
}

export function GameBoard({
  nowPlaying,
  options,
  phase,
  pendingSelectionTrackId,
  onSelectOption,
  activePlayerId,
  roundTurn,
  difficulty,
  onDifficultyChange,
  turnExpired,
  turnTimeRemaining,
  turnTimerActive,
  isWaitingForFirstTrack,
  players,
  playerNames,
  playerGravities,
  availableArtists,
  onTargetArtistChange,
  onPlayerNameChange
}: GameBoardProps): JSX.Element {
  const currentTrack = nowPlaying?.item
  const [feedbackForPlayer, setFeedbackForPlayer] = useState<PlayerId | null>(
    null
  )
  const feedbackRoundRef = useRef<number | null>(null)
  const previousOptionsRef = useRef<string | null>(null)
  const [currentTrackGenre, setCurrentTrackGenre] = useState<string | null>(
    null
  )

  const isSelecting =
    phase === 'selecting' &&
    !turnExpired &&
    !pendingSelectionTrackId &&
    !feedbackForPlayer

  // Show feedback after a selection is made, keep it visible until new options arrive
  useEffect(() => {
    if (pendingSelectionTrackId !== null) {
      // Selection made - show feedback for active player and track the round
      setFeedbackForPlayer(activePlayerId)
      feedbackRoundRef.current = roundTurn
    } else if (
      feedbackForPlayer !== null &&
      feedbackRoundRef.current !== null
    ) {
      // Check if round has changed since feedback was shown
      if (roundTurn !== feedbackRoundRef.current) {
        // New round - clear feedback
        setFeedbackForPlayer(null)
        feedbackRoundRef.current = null
      }
    }

    // Track options changes to detect when truly new options arrive
    const currentOptionsKey = options
      .map((opt) => opt.track.id)
      .sort()
      .join(',')
    if (
      previousOptionsRef.current !== null &&
      previousOptionsRef.current !== currentOptionsKey
    ) {
      // Options have actually changed - clear feedback if it was showing
      if (feedbackForPlayer !== null) {
        setFeedbackForPlayer(null)
        feedbackRoundRef.current = null
      }
    }
    previousOptionsRef.current = currentOptionsKey
  }, [
    pendingSelectionTrackId,
    activePlayerId,
    roundTurn,
    feedbackForPlayer,
    options
  ])

  // Shuffle options for random display order (Fisher-Yates algorithm)
  // Only re-shuffles when options prop changes or current track ID changes
  const shuffledOptions = useMemo(() => {
    const visible = currentTrack?.id
      ? options.filter((option) => option.track.id !== currentTrack.id)
      : options

    const shuffled = [...visible]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }, [options, currentTrack?.id])

  // Create Supabase client for fetching genre
  const supabase = useMemo(
    () =>
      createBrowserClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  // Fetch genre for currently playing track
  useEffect(() => {
    if (!currentTrack?.id) {
      setCurrentTrackGenre(null)
      return
    }

    // First, check if the track is in the options (which would have genre)
    const optionTrack = options.find((opt) => opt.track.id === currentTrack.id)
    if (optionTrack?.track.genre) {
      setCurrentTrackGenre(optionTrack.track.genre)
      return
    }

    // If not found in options, fetch from database
    const fetchGenre = async (): Promise<void> => {
      try {
        const { data, error } = await supabase
          .from('tracks')
          .select('genre')
          .eq('spotify_track_id', currentTrack.id)
          .maybeSingle()

        if (!error && data?.genre) {
          setCurrentTrackGenre(data.genre)
        } else {
          setCurrentTrackGenre(null)
        }
      } catch (error) {
        console.error('Error fetching track genre:', error)
        setCurrentTrackGenre(null)
      }
    }

    void fetchGenre()
  }, [currentTrack?.id, options, supabase])

  // ...

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

              {/* Turn Timer - Hide when a selection has been made */}
              {(turnTimerActive ||
                (turnExpired && !pendingSelectionTrackId)) && (
                <div className='mt-4 flex flex-col items-center gap-2 border-t border-gray-800 pt-4'>
                  <div className='relative h-24 w-24'>
                    <svg className='h-full w-full -rotate-90 transform'>
                      <circle
                        cx='48'
                        cy='48'
                        r='36'
                        stroke='currentColor'
                        strokeWidth='6'
                        fill='none'
                        className='text-gray-700'
                      />
                      <circle
                        cx='48'
                        cy='48'
                        r='36'
                        stroke={
                          turnExpired
                            ? '#ef4444'
                            : turnTimeRemaining <= 15
                              ? '#ef4444'
                              : turnTimeRemaining <= 30
                                ? '#f59e0b'
                                : '#10b981'
                        }
                        strokeWidth='6'
                        fill='none'
                        strokeDasharray={2 * Math.PI * 36}
                        strokeDashoffset={
                          2 * Math.PI * 36 -
                          (((turnTimeRemaining / 60) * 100) / 100) *
                            (2 * Math.PI * 36)
                        }
                        className={`transition-all duration-1000 ${turnTimeRemaining <= 15 && !turnExpired ? 'animate-pulse' : ''}`}
                        strokeLinecap='round'
                      />
                    </svg>
                    <div className='absolute inset-0 flex items-center justify-center'>
                      {turnExpired ? (
                        <div className='text-center'>
                          <div className='text-[10px] font-bold text-red-500'>
                            TIME&apos;S
                          </div>
                          <div className='text-[10px] font-bold text-red-500'>
                            UP!
                          </div>
                        </div>
                      ) : (
                        <div className='text-center'>
                          <div
                            className='text-2xl font-bold'
                            style={{
                              color:
                                turnTimeRemaining <= 15
                                  ? '#ef4444'
                                  : turnTimeRemaining <= 30
                                    ? '#f59e0b'
                                    : '#10b981'
                            }}
                          >
                            {turnTimeRemaining}
                          </div>
                          <div className='text-[9px] text-gray-400'>sec</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {turnExpired && (
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
        {players.map((player) => (
          <PlayerHud
            key={player.id}
            id={player.id as PlayerId}
            label={playerNames[player.id as PlayerId]}
            score={player.score}
            targetArtist={player.targetArtist}
            isActive={player.id === activePlayerId}
            isSelecting={phase === 'selecting'}
            gravity={playerGravities[player.id as PlayerId]}
            onTargetArtistChange={
              onTargetArtistChange
                ? (artist) =>
                    onTargetArtistChange(player.id as PlayerId, artist)
                : undefined
            }
            onLabelChange={
              onPlayerNameChange
                ? (name) => onPlayerNameChange(player.id as PlayerId, name)
                : undefined
            }
            availableArtists={availableArtists}
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
              {phase === 'waiting_for_track'
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
                    onDifficultyChange(mode.id as 'easy' | 'medium' | 'hard')
                  }
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                    difficulty === mode.id
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
            {isWaitingForFirstTrack ? (
              // Show waiting message when waiting for first track
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
            ) : phase === 'loading' && shuffledOptions.length === 0 ? (
              // Show skeleton cards while loading
              Array.from({ length: 6 }).map((_, index) => (
                <GameOptionSkeleton key={`skeleton-${index}`} />
              ))
            ) : shuffledOptions.length > 0 ? (
              shuffledOptions.map((option) => {
                const isQueued = option.track.id === pendingSelectionTrackId
                const cardFeedback = getCardFeedback(option)
                const isSelectedTrack =
                  option.track.id === pendingSelectionTrackId &&
                  feedbackForPlayer !== null

                return (
                  <GameOptionNode
                    key={option.track.id}
                    option={option}
                    disabled={!isSelecting}
                    isQueued={isQueued}
                    onSelect={onSelectOption}
                    feedbackResult={cardFeedback}
                    isSelected={isSelectedTrack}
                    difficulty={difficulty}
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
