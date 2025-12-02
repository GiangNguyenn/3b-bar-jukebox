'use client'

import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { GameOptionTrack } from '@/services/gameService'
import { GameOptionNode } from './GameOptionNode'

type GamePhase = 'loading' | 'selecting' | 'waiting_for_track'

interface GameBoardProps {
  nowPlaying: SpotifyPlaybackState | null
  options: GameOptionTrack[]
  phase: GamePhase
  pendingSelectionTrackId: string | null
  onSelectOption: (option: GameOptionTrack) => void
}

export function GameBoard({
  nowPlaying,
  options,
  phase,
  pendingSelectionTrackId,
  onSelectOption
}: GameBoardProps): JSX.Element {
  const currentTrack = nowPlaying?.item
  const isSelecting = phase === 'selecting'

  const visibleOptions = currentTrack
    ? options.filter((option) => option.track.id !== currentTrack.id)
    : options

  return (
    <div className='mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row md:items-stretch'>
      <div className='flex-1'>
        <div className='flex h-full flex-col rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-black to-gray-900 p-5 shadow-lg'>
          <p className='text-xs font-semibold uppercase tracking-wide text-gray-500'>
            Now Playing
          </p>
          {currentTrack ? (
            <>
              <h2 className='mt-2 text-2xl font-bold text-white'>
                {currentTrack.name}
              </h2>
              <p className='mt-1 text-sm text-gray-300'>
                {currentTrack.artists[0]?.name ?? 'Unknown Artist'}
              </p>
              <p className='mt-1 text-xs text-gray-500'>
                {currentTrack.album?.name ?? 'Unknown Album'}
              </p>
              <p className='mt-4 text-xs text-gray-400'>
                Select a related song to play next. When it starts playing, the
                turn passes to the other player.
              </p>
              <div className='mt-auto pt-4 text-xs text-gray-500'>
                <span className='inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-300'>
                  {nowPlaying?.is_playing ? 'Playing' : 'Paused'}
                </span>
              </div>
            </>
          ) : (
            <div className='mt-4 text-sm text-gray-400'>
              No track is currently playing. Start playback to begin the game.
            </div>
          )}
        </div>
      </div>

      <div className='flex-[1.4]'>
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
          </div>

          <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {visibleOptions.map((option) => {
              const isQueued = option.track.id === pendingSelectionTrackId

              return (
                <GameOptionNode
                  key={option.track.id}
                  option={option}
                  disabled={!isSelecting}
                  isQueued={isQueued}
                  onSelect={onSelectOption}
                />
              )
            })}
            {!visibleOptions.length && phase === 'loading' && (
              <p className='col-span-full mt-4 text-sm text-gray-500'>
                Loading related songs...
              </p>
            )}
            {!visibleOptions.length && phase !== 'loading' && (
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


