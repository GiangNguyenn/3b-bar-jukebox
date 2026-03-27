'use client'

import React, { useState } from 'react'

export interface NameEntryModalProps {
  onJoin: (name: string) => void
}

export function NameEntryModal({
  onJoin
}: NameEntryModalProps): React.ReactElement {
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
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm'>
      <div className='w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl duration-200 animate-in zoom-in-95 sm:p-8'>
        <div className='mb-6 text-center'>
          <div className='mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400'>
            <svg
              className='h-8 w-8'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z'
              />
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
          </div>
          <h2 className='text-white text-2xl font-black'>Join Song Trivia</h2>
          <p className='mt-2 text-zinc-400'>
            Test your music knowledge and climb the live leaderboard!
          </p>
        </div>

        <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
          <div>
            <label
              htmlFor='playerName'
              className='mb-1 block text-sm font-medium text-zinc-300'
            >
              Choose a Display Name
            </label>
            <input
              id='playerName'
              type='text'
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              className='text-white w-full rounded-xl border-2 border-zinc-700 bg-zinc-800 px-4 py-3 placeholder-zinc-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'
              placeholder='e.g. MusicNerd99'
              autoFocus
              maxLength={20}
            />
            {error && <p className='mt-1 text-sm text-red-400'>{error}</p>}
          </div>

          <button
            type='submit'
            className='text-white mt-2 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold transition-colors hover:bg-indigo-500'
          >
            Start Playing
          </button>
        </form>
      </div>
    </div>
  )
}
