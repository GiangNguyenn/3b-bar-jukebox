'use client'

import type { TargetArtist } from '@/services/gameService'
import { useState } from 'react'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { ArtistSelectionModal } from './ArtistSelectionModal'
import { cn } from '@/lib/utils'

type PlayerId = 'player1' | 'player2'

interface PlayerHudProps {
  id: PlayerId
  label: string
  score: number
  targetArtist: TargetArtist | null
  isActive: boolean
  isSelecting: boolean
  gravity: number
  onTargetArtistChange?: (artist: TargetArtist) => void
  onLabelChange?: (name: string) => void
  availableArtists: TargetArtist[]
}

export function PlayerHud({
  id,
  label,
  score,
  targetArtist,
  isActive,
  isSelecting,
  gravity,
  onTargetArtistChange,
  onLabelChange,
  availableArtists
}: PlayerHudProps): JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [editedLabel, setEditedLabel] = useState(label)
  const borderColor = isActive
    ? 'border-green-500/50 shadow-[0_0_15px_-3px_rgba(34,197,94,0.2)]'
    : 'border-gray-800'
  const bgColor = isActive
    ? 'bg-gradient-to-br from-gray-900/90 to-gray-900/50 backdrop-blur-sm'
    : 'bg-gradient-to-br from-gray-950/80 to-gray-900/30 backdrop-blur-sm'
  const textColor = isActive ? 'text-green-300' : 'text-gray-400'

  // Enrich target artist with genre from availableArtists if missing
  const enrichedTargetArtist = targetArtist
    ? (() => {
        if (targetArtist.genre) return targetArtist
        const found = availableArtists.find(
          (artist) =>
            artist.id === targetArtist.id || artist.name === targetArtist.name
        )
        return found ? { ...targetArtist, genre: found.genre } : targetArtist
      })()
    : null

  const handleArtistClick = (): void => {
    if (onTargetArtistChange) {
      setIsModalOpen(true)
    }
  }

  const handleSelectArtist = (artist: TargetArtist): void => {
    onTargetArtistChange?.(artist)
  }

  const handleRandomArtist = (): void => {
    if (!onTargetArtistChange || availableArtists.length === 0) return

    // Filter out current artist to avoid selecting the same one
    const otherArtists = availableArtists.filter(
      (artist) => artist.name !== targetArtist?.name
    )

    const artistsToChooseFrom =
      otherArtists.length > 0 ? otherArtists : availableArtists
    const randomIndex = Math.floor(Math.random() * artistsToChooseFrom.length)
    const randomArtist = artistsToChooseFrom[randomIndex]

    if (randomArtist?.name) {
      onTargetArtistChange(randomArtist)
    }
  }

  const handleLabelClick = (): void => {
    if (onLabelChange) {
      setEditedLabel(label)
      setIsEditingLabel(true)
    }
  }

  const handleLabelSubmit = (): void => {
    const trimmedLabel = editedLabel.trim()
    if (trimmedLabel && onLabelChange) {
      onLabelChange(trimmedLabel)
    } else {
      setEditedLabel(label) // Reset to original if empty
    }
    setIsEditingLabel(false)
  }

  const handleLabelKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (e.key === 'Enter') {
      handleLabelSubmit()
    } else if (e.key === 'Escape') {
      setEditedLabel(label)
      setIsEditingLabel(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex flex-col rounded-xl border px-3 py-2 shadow-sm transition-all duration-300 md:px-4 md:py-3',
          borderColor,
          bgColor
        )}
        aria-label={`Status for ${label}`}
        data-player-id={id}
      >
        <div className='flex items-center justify-between'>
          {isEditingLabel ? (
            <input
              type='text'
              value={editedLabel}
              onChange={(e) => setEditedLabel(e.target.value)}
              onBlur={handleLabelSubmit}
              onKeyDown={handleLabelKeyDown}
              autoFocus
              maxLength={20}
              className='w-full rounded bg-gray-800 px-2 py-1 text-sm font-semibold uppercase tracking-wide text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500'
              aria-label='Edit player name'
            />
          ) : (
            <button
              onClick={handleLabelClick}
              disabled={!onLabelChange}
              className={cn(
                'min-h-[44px] py-2 text-sm font-semibold uppercase tracking-wide',
                onLabelChange
                  ? 'cursor-pointer text-gray-400 transition-colors hover:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900'
                  : 'cursor-default text-gray-400'
              )}
              aria-label='Click to edit player name'
              title={onLabelChange ? 'Click to edit name' : undefined}
            >
              {label}
            </button>
          )}
          <span className='font-mono text-xs text-gray-500'>
            Score:{' '}
            <span className='text-white text-lg font-bold' aria-label='Score'>
              {score}
            </span>
          </span>
        </div>
        <div className='mt-2 text-sm'>
          <div className='flex items-center justify-between'>
            <p className='text-xs text-gray-500'>Target Artist</p>
            {onTargetArtistChange && (
              <button
                onClick={handleRandomArtist}
                className='group rounded p-2 transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900'
                aria-label='Pick random target artist'
                title='Pick random target artist'
              >
                <SparklesIcon className='h-5 w-5 text-gray-500 transition-colors group-hover:text-green-400' />
              </button>
            )}
          </div>
          <button
            onClick={handleArtistClick}
            disabled={!onTargetArtistChange}
            className={cn(
              'truncate text-left text-base font-semibold transition-colors',
              onTargetArtistChange
                ? '-mx-1 cursor-pointer rounded px-1 py-2 hover:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900'
                : 'cursor-default py-2',
              textColor
            )}
            aria-label={`Change target artist for ${label}`}
          >
            {enrichedTargetArtist?.name ?? 'Waiting for assignment'}
            {onTargetArtistChange && (
              <span className='ml-1 text-xs opacity-60'>(click to change)</span>
            )}
          </button>
          {enrichedTargetArtist?.genre && (
            <p className='mt-1 text-xs text-gray-500'>
              Genre:{' '}
              <span className='font-semibold capitalize text-gray-400'>
                {enrichedTargetArtist.genre}
              </span>
            </p>
          )}
        </div>

        {/* Gravity Strength Indicator */}
        <div className='mt-3 space-y-1'>
          <div className='flex items-center justify-between'>
            <p className='text-xs text-gray-500'>Influence</p>
            <span className='font-mono text-xs text-gray-400'>
              {Math.min(
                100,
                Math.max(0, ((gravity - 0.15) / (0.7 - 0.15)) * 100)
              ).toFixed(0)}
              %
            </span>
          </div>
          <div className='h-2 w-full overflow-hidden rounded-full bg-gray-800'>
            <div
              className='h-full rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-500 ease-out'
              style={{
                width: `${((gravity - 0.15) / (0.7 - 0.15)) * 100}%`
              }}
              aria-label={`Power level: ${gravity.toFixed(2)}`}
            />
          </div>
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
          artists={availableArtists}
        />
      )}
    </>
  )
}
