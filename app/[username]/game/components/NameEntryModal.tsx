'use client'

import React, { useState } from 'react'

export interface NameEntryModalProps {
  onJoin: (name: string) => void
}

export function NameEntryModal({ onJoin }: NameEntryModalProps): React.ReactElement {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmed = name.trim()
    
    if (trimmed.length < 1) {
      setError('Name cannot be empty')
      return
    }
    
    if (trimmed.length > 20) {
      setError('Name must be 20 characters or less')
      return
    }
    
    onJoin(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/20 text-indigo-400 mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-white">Join Song Trivia</h2>
          <p className="text-zinc-400 mt-2">Test your music knowledge and climb the live leaderboard!</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="playerName" className="block text-sm font-medium text-zinc-300 mb-1">
              Choose a Display Name
            </label>
            <input
              id="playerName"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              className="w-full bg-zinc-800 border-2 border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
              placeholder="e.g. MusicNerd99"
              autoFocus
              maxLength={20}
            />
            {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl transition-colors mt-2"
          >
            Start Playing
          </button>
        </form>
      </div>
    </div>
  )
}
