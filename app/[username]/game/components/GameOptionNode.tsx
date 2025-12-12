'use client'

import type { DgsOptionTrack } from '@/services/game/dgsTypes'
import { cn } from '@/lib/utils'

interface GameOptionNodeProps {
  option: DgsOptionTrack
  disabled?: boolean
  isQueued?: boolean
  onSelect: (option: DgsOptionTrack) => void
  feedbackResult?: 'closer' | 'neutral' | 'further'
  isSelected?: boolean
  difficulty: 'easy' | 'medium' | 'hard'
}

export function GameOptionNode({
  option,
  disabled = false,
  isQueued = false,
  onSelect,
  feedbackResult,
  isSelected = false,
  difficulty
}: GameOptionNodeProps): JSX.Element {
  const { track, artist } = option

  // Configuration for feedback styles
  const feedbackConfig = {
    closer: {
      border: 'border-green-500',
      bgBase: 'bg-green-900/40',
      bgIntense: 'bg-green-900/70',
      shadowBase: 'shadow-[0_0_10px_rgba(34,197,94,0.3)]',
      shadowIntense: 'shadow-[0_0_20px_rgba(34,197,94,0.6)]',
      intensity: 'ring-2 ring-green-500/50'
    },
    neutral: {
      border: 'border-blue-500',
      bgBase: 'bg-blue-900/40',
      bgIntense: 'bg-blue-900/70',
      shadowBase: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]',
      shadowIntense: 'shadow-[0_0_20px_rgba(59,130,246,0.6)]',
      intensity: 'ring-2 ring-blue-500/50'
    },
    further: {
      border: 'border-orange-500',
      bgBase: 'bg-orange-900/40',
      bgIntense: 'bg-orange-900/70',
      shadowBase: 'shadow-[0_0_10px_rgba(249,115,22,0.3)]',
      shadowIntense: 'shadow-[0_0_20px_rgba(249,115,22,0.6)]',
      intensity: 'ring-2 ring-orange-500/50'
    }
  }

  const getButtonStyles = (): string => {
    if (disabled) {
      return 'cursor-not-allowed border-gray-700 bg-gray-900/40 opacity-60'
    }

    if (!feedbackResult) {
      return cn(
        'cursor-pointer hover:border-green-400 hover:bg-gray-900',
        isQueued
          ? 'border-green-400 bg-gray-900/80 shadow-[0_0_0_1px_rgba(74,222,128,0.6)]'
          : 'border-gray-700 bg-gray-900/70'
      )
    }

    const config = feedbackConfig[feedbackResult]
    const isIntense = isSelected

    return cn(
      'cursor-pointer',
      config.border,
      isIntense ? config.bgIntense : config.bgBase,
      isIntense ? config.shadowIntense : config.shadowBase,
      isIntense && config.intensity
    )
  }

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) {
          onSelect(option)
        }
      }}
      className={cn(
        'relative flex h-full w-full flex-col items-start justify-between rounded-xl border px-3 py-2.5 text-left transition-all duration-300 active:scale-[0.98] sm:px-4 sm:py-3 sm:hover:scale-[1.02]',
        getButtonStyles()
      )}
    >
      <div>
        <p className='text-white mb-0.5 line-clamp-2 text-base font-semibold leading-tight'>
          {track.name}
        </p>

        {/* Artist - Hidden in Hard mode */}
        {difficulty !== 'hard' && (
          <p className='text-sm text-gray-400'>
            {artist?.name ?? track.artists?.[0]?.name ?? 'Unknown artist'}
            {difficulty === 'easy' && (
              <>
                <span className='text-gray-600'> • </span>
                {track.album?.name ?? 'Unknown album'}
              </>
            )}
          </p>
        )}
      </div>
      <div className='mt-2 flex w-full items-center justify-between text-[11px]'>
        {/* Genre/Metadata - Only visible in Easy mode */}
        {difficulty === 'easy' ? (
          <p className='text-gray-500'>
            Genre:{' '}
            <span className='font-semibold capitalize text-gray-300'>
              {track.genre ?? option.metrics.artistGenres?.[0] ?? 'Unknown'}
              {track.popularity !== undefined && (
                <span className='font-normal text-gray-400'>
                  {' '}
                  ({track.popularity})
                </span>
              )}
            </span>
          </p>
        ) : (
          /* Spacer for alignment when metadata is hidden */
          <div />
        )}
        {isQueued && !feedbackResult && (
          <span className='rounded-full border border-green-500/40 bg-green-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-300'>
            ✓ Selected
          </span>
        )}
        {feedbackResult && (
          <div className='flex items-center gap-1.5'>
            {isSelected && (
              <span className='rounded-full border border-green-500/40 bg-green-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green-300'>
                ✓ Your Pick
              </span>
            )}
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                feedbackResult === 'closer'
                  ? 'border border-green-500/50 bg-green-500/30 text-green-200'
                  : feedbackResult === 'neutral'
                    ? 'border border-blue-500/50 bg-blue-500/30 text-blue-200'
                    : 'border border-orange-500/50 bg-orange-500/30 text-orange-200'
              }`}
            >
              {feedbackResult === 'closer' ? (
                <>✓ Good</>
              ) : feedbackResult === 'neutral' ? (
                <>− Neutral</>
              ) : (
                <>✗ Bad</>
              )}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}
