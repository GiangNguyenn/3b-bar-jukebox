'use client'

import React, { useState } from 'react'
import type { LeaderboardEntry } from '@/hooks/trivia/useTriviaLeaderboard'

export interface LeaderboardProps {
  entries: LeaderboardEntry[]
  currentSessionId: string
  isLoading: boolean
}

export function Leaderboard({ entries, currentSessionId, isLoading }: LeaderboardProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="w-full bg-zinc-900/30 rounded-xl p-4 flex items-center justify-center min-h-[60px]">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Find user's current rank
  const myIndex = entries.findIndex((e) => e.session_id === currentSessionId)
  const myEntry = myIndex !== -1 ? entries[myIndex] : null
  const myRank = myIndex !== -1 ? myIndex + 1 : '-'

  return (
    <div className="w-full bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden mb-8">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">🏆 Live Leaderboard</span>
        </div>
        
        <div className="flex items-center gap-4">
          {myEntry && !isOpen && (
            <div className="px-3 py-1 bg-indigo-900/30 text-indigo-300 text-sm rounded-full font-medium border border-indigo-800/50 hidden sm:block">
              Rank: #{myRank} • {myEntry.score} pts
            </div>
          )}
          
          <svg 
            className={`w-5 h-5 text-zinc-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="pb-4">
          <div className="h-px bg-zinc-800 w-full mb-2" />
          
          {entries.length === 0 ? (
            <div className="p-6 text-center text-zinc-500 italic">
              No scores yet this hour. Be the first!
            </div>
          ) : (
            <div className="flex flex-col gap-1 px-2 max-h-80 overflow-y-auto">
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
                    className={`flex items-center justify-between p-3 rounded-lg ${isMe ? 'bg-indigo-900/30 border border-indigo-800/50' : 'hover:bg-zinc-800/30'}`}
                  >
                    <div className="flex items-center gap-4">
                      <span className={`w-6 text-center ${rankColor}`}>
                        {rank}
                      </span>
                      <span className={`font-medium ${isMe ? 'text-indigo-300' : 'text-zinc-200'}`}>
                        {entry.player_name}
                        {isMe && <span className="ml-2 text-xs bg-indigo-500/20 px-2 py-0.5 rounded text-indigo-400">You</span>}
                      </span>
                    </div>
                    <span className="font-mono text-zinc-400 font-bold">
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
