'use client'

import type { GameOptionTrack } from '@/services/gameService'

interface GameOptionNodeProps {
  option: GameOptionTrack
  disabled?: boolean
  isQueued?: boolean
  onSelect: (option: GameOptionTrack) => void
}

export function GameOptionNode({
  option,
  disabled = false,
  isQueued = false,
  onSelect
}: GameOptionNodeProps): JSX.Element {
  const { track, artist } = option

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onSelect(option)
        }
      }}
      className={`flex h-full w-full flex-col items-start justify-between rounded-xl border px-3 py-2 text-left transition
        ${
          disabled
            ? 'border-gray-700 bg-gray-900/40 opacity-60 cursor-not-allowed'
            : isQueued
              ? 'border-green-400 bg-gray-900/80 shadow-[0_0_0_1px_rgba(74,222,128,0.6)]'
              : 'border-gray-700 bg-gray-900/70 hover:border-green-400 hover:bg-gray-900'
        }`}
    >
      <div>
        <p className='line-clamp-2 text-sm font-semibold text-white'>
          {track.name}
        </p>
        <p className='mt-1 text-xs text-gray-400'>
          {artist.name}{' '}
          <span className='text-gray-600'>•</span>{' '}
          {track.album?.name ?? 'Unknown album'}
        </p>
      </div>
      <div className='mt-2 flex w-full items-center justify-between text-[11px]'>
        <p className='text-gray-500'>
          Popularity:{' '}
          <span className='font-semibold text-gray-300'>
            {track.popularity ?? 0}
          </span>
        </p>
        {isQueued && (
          <span className='rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-300'>
            Queued Next
          </span>
        )}
      </div>
    </button>
  )
}


