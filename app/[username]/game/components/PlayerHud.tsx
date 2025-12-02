'use client'

import type { TargetArtist } from '@/services/gameService'
import { useState } from 'react'
import { ArtistSelectionModal } from './ArtistSelectionModal'

type PlayerId = 'player1' | 'player2'

interface PlayerHudProps {
  id: PlayerId
  label: string
  score: number
  targetArtist: TargetArtist | null
  isActive: boolean
  isSelecting: boolean
  onTargetArtistChange?: (artist: TargetArtist) => void
}

export function PlayerHud({
  id,
  label,
  score,
  targetArtist,
  isActive,
  isSelecting,
  onTargetArtistChange
}: PlayerHudProps): JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const borderColor = isActive ? 'border-green-400' : 'border-gray-700'
  const bgColor = isActive ? 'bg-gray-900/70' : 'bg-gray-900/40'
  const textColor = isActive ? 'text-green-300' : 'text-gray-300'

  const handleArtistClick = (): void => {
    if (onTargetArtistChange) {
      setIsModalOpen(true)
    }
  }

  const handleSelectArtist = (artist: TargetArtist): void => {
    onTargetArtistChange?.(artist)
  }

  return (
    <>
      <div
        className={`flex flex-col rounded-xl border px-4 py-3 shadow-sm ${borderColor} ${bgColor}`}
        aria-label={`Status for ${label}`}
        data-player-id={id}
      >
        <div className='flex items-center justify-between'>
          <span className='text-sm font-semibold uppercase tracking-wide text-gray-400'>
            {label}
          </span>
          <span className='font-mono text-xs text-gray-500'>
            Score:{' '}
            <span className='text-white text-lg font-bold' aria-label='Score'>
              {score}
            </span>
          </span>
        </div>
        <div className='mt-2 text-sm'>
          <p className='text-xs text-gray-500'>Target Artist</p>
          <button
            onClick={handleArtistClick}
            disabled={!onTargetArtistChange}
            className={`truncate text-left text-base font-semibold transition-colors ${
              onTargetArtistChange
                ? '-mx-1 cursor-pointer rounded px-1 hover:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900'
                : 'cursor-default'
            } ${textColor}`}
            aria-label={`Change target artist for ${label}`}
          >
            {targetArtist?.name ?? 'Waiting for assignment'}
            {onTargetArtistChange && (
              <span className='ml-1 text-xs opacity-60'>(click to change)</span>
            )}
          </button>
        </div>
        {isActive && isSelecting && (
          <p className='mt-1 text-xs font-medium text-green-400'>
            Your turn – pick the next song
          </p>
        )}
      </div>

      {onTargetArtistChange && (
        <ArtistSelectionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          currentArtist={targetArtist}
          onSelect={handleSelectArtist}
          playerLabel={label}
        />
      )}
    </>
  )
}
