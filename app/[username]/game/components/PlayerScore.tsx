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

export function PlayerScore({ score, timeUntilReset }: PlayerScoreProps): React.ReactElement {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 md:p-6 mb-6">
      <div className="flex flex-col items-center sm:items-start mb-4 sm:mb-0">
        <span className="text-zinc-400 text-sm font-semibold uppercase tracking-wider mb-1">Your Score</span>
        <div className="text-4xl font-black text-indigo-400">{score}</div>
      </div>
      
      <div className="flex flex-col items-center sm:items-end">
        <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-1 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Next Reset
        </span>
        <div className={`text-2xl font-mono font-bold ${timeUntilReset < 60 ? 'text-red-400 animate-pulse' : 'text-zinc-300'}`}>
          {formatTime(timeUntilReset)}
        </div>
      </div>
    </div>
  )
}
