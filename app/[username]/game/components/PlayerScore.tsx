'use client'

import React from 'react'

export interface PlayerScoreProps {
  score: number
  timeUntilReset: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function PlayerScore({
  score,
  timeUntilReset
}: PlayerScoreProps): React.ReactElement {
  return (
    <div className='mb-6 flex flex-col items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:flex-row md:p-6'>
      <div className='mb-4 flex flex-col items-center sm:mb-0 sm:items-start'>
        <span className='mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400'>
          Your Score
        </span>
        <div className='text-4xl font-black text-indigo-400'>{score}</div>
      </div>

      <div className='flex flex-col items-center sm:items-end'>
        <span className='mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500'>
          <svg
            className='h-4 w-4'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
            />
          </svg>
          Next Reset
        </span>
        <div
          className={`font-mono text-2xl font-bold ${timeUntilReset < 60 ? 'animate-pulse text-red-400' : 'text-zinc-300'}`}
        >
          {formatTime(timeUntilReset)}
        </div>
      </div>
    </div>
  )
}
