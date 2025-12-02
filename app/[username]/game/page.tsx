'use client'

import type { JSX } from 'react'
import { useParams } from 'next/navigation'
import { useMusicGame } from '@/hooks/game/useMusicGame'
import { PlayerHud } from './components/PlayerHud'
import { GameBoard } from './components/GameBoard'
import { ScoreAnimation } from './components/ScoreAnimation'
import { Loading, ErrorMessage } from '@/components/ui'

export default function GamePage(): JSX.Element {
  const params = useParams()
  const username = typeof params?.username === 'string' ? params.username : ''

  const {
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
    updatePlayerTargetArtist
  } = useMusicGame({ username })

  const isInitialLoading = phase === 'loading' && !nowPlaying && !error

  if (isInitialLoading) {
    return <Loading fullScreen message='Loading game…' />
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
    <div className='min-h-screen bg-gradient-to-b from-black via-gray-950 to-black text-white'>
      <div className='mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4'>
        <header className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>
              Music Connection Game
            </h1>
            <p className='mt-1 text-sm text-gray-400'>
              Take turns picking the next song. Score points when your target
              artist starts playing.
            </p>
          </div>
          <div className='flex flex-col gap-2 md:min-w-[320px]'>
            <div className='grid grid-cols-2 gap-2'>
              {players.map((player) => (
                <PlayerHud
                  key={player.id}
                  id={player.id}
                  label={player.id === 'player1' ? 'Player 1' : 'Player 2'}
                  score={player.score}
                  targetArtist={player.targetArtist}
                  isActive={player.id === activePlayerId}
                  isSelecting={phase === 'selecting'}
                  onTargetArtistChange={(artist) =>
                    updatePlayerTargetArtist(player.id, artist)
                  }
                />
              ))}
            </div>
            {username && (
              <p className='text-xs text-gray-500'>
                Game linked to jukebox for{' '}
                <span className='font-mono text-gray-300'>{username}</span>
              </p>
            )}
          </div>
        </header>

        {error && nowPlaying && (
          <div className='max-w-md'>
            <ErrorMessage message={error} variant='error' />
          </div>
        )}

        <GameBoard
          nowPlaying={nowPlaying}
          options={options}
          phase={phase}
          pendingSelectionTrackId={pendingSelectionTrackId}
          onSelectOption={handleSelectOption}
        />

        {isBusy && (
          <p className='px-4 text-xs text-gray-500'>
            Working with Spotify… please wait.
          </p>
        )}
      </div>

      <ScoreAnimation
        playerId={scoringPlayer?.playerId ?? null}
        playerLabel={
          scoringPlayer?.playerId === 'player1' ? 'Player 1' : 'Player 2'
        }
        artistName={scoringPlayer?.artistName ?? null}
        onComplete={onScoreAnimationComplete}
      />
    </div>
  )
}


