'use client'

import React, { useState } from 'react'
import type { LeaderboardEntry } from '@/hooks/trivia/useTriviaLeaderboard'

export interface LeaderboardProps {
  entries: LeaderboardEntry[]
  currentSessionId: string
  isLoading: boolean
}

export function Leaderboard({
  entries,
  currentSessionId,
  isLoading
}: LeaderboardProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  if (isLoading) {
    return (
      <div className='flex min-h-[60px] w-full items-center justify-center rounded-xl bg-zinc-900/30 p-4'>
        <div className='h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent' />
      </div>
    )
  }

  // Find user's current rank
  const myIndex = entries.findIndex((e) => e.session_id === currentSessionId)
  const myEntry = myIndex !== -1 ? entries[myIndex] : null
  const myRank = myIndex !== -1 ? myIndex + 1 : '-'

  return (
    <div className='mb-8 w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40'>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className='flex w-full items-center justify-between p-4 transition-colors hover:bg-zinc-800/50'
      >
        <div className='flex items-center gap-3'>
          <span className='text-white text-lg font-bold'>
            🏆 Live Leaderboard
          </span>
        </div>

        <div className='flex items-center gap-4'>
          {myEntry && !isOpen && (
            <div className='hidden rounded-full border border-indigo-800/50 bg-indigo-900/30 px-3 py-1 text-sm font-medium text-indigo-300 sm:block'>
              Rank: #{myRank} • {myEntry.score} pts
            </div>
          )}

          <svg
            className={`h-5 w-5 text-zinc-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className='pb-4'>
          <div className='mb-2 h-px w-full bg-zinc-800' />

          {entries.length === 0 ? (
            <div className='p-6 text-center italic text-zinc-500'>
              No scores yet this hour. Be the first!
            </div>
          ) : (
            <div className='flex max-h-80 flex-col gap-1 overflow-y-auto px-2'>
              {entries.map((entry, idx) => {
                const isMe = entry.session_id === currentSessionId
                const rank = idx + 1

                let rankColor = 'text-zinc-500 font-medium'
                if (rank === 1) rankColor = 'text-yellow-400 font-black'
                else if (rank === 2) rankColor = 'text-zinc-300 font-bold'
                else if (rank === 3) rankColor = 'text-orange-400 font-bold'

                return (
                  <div
                    key={entry.session_id}
                    className={`flex items-center justify-between rounded-lg p-3 ${isMe ? 'border border-indigo-800/50 bg-indigo-900/30' : 'hover:bg-zinc-800/30'}`}
                  >
                    <div className='flex items-center gap-4'>
                      <span className={`w-6 text-center ${rankColor}`}>
                        {rank}
                      </span>
                      <span
                        className={`font-medium ${isMe ? 'text-indigo-300' : 'text-zinc-200'}`}
                      >
                        {entry.player_name}
                        {isMe && (
                          <span className='ml-2 rounded bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-400'>
                            You
                          </span>
                        )}
                      </span>
                    </div>
                    <span className='font-mono font-bold text-zinc-400'>
                      {entry.score}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
