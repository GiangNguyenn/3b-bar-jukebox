'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'

type PlayerId = 'player1' | 'player2'

interface ScoreAnimationProps {
  playerId: PlayerId | null
  playerLabel: string
  artistName: string | null
  onComplete: () => void
}

export function ScoreAnimation({
  playerId,
  playerLabel,
  artistName,
  onComplete
}: ScoreAnimationProps): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (playerId) {
      setIsVisible(true)
      const timer = setTimeout(() => {
        setIsVisible(false)
        setTimeout(onComplete, 300) // Wait for fade-out to complete
      }, 1250) // Show animation for 1.25 seconds (half of original 2.5s)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [playerId, onComplete])

  if (!playerId || !isVisible) {
    return null
  }

  return (
    <div className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center'>
      {/* Backdrop */}
      <div className='absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300' />

      {/* Animation Container */}
      <div className='animate-score-celebration relative'>
        {/* Glowing ring effect */}
        <div className='absolute inset-0 -m-8 animate-ping rounded-full border-4 border-green-400/50' />
        <div className='absolute inset-0 -m-6 animate-pulse rounded-full border-4 border-green-400/30' />

        {/* Main content */}
        <div className='relative rounded-2xl border-4 border-green-400 bg-gradient-to-br from-green-900/95 to-emerald-900/95 px-12 py-8 shadow-2xl'>
          <div className='text-center'>
            {/* Score icon/emoji */}
            <div className='mb-4 animate-bounce text-6xl'>🎵</div>

            {/* Player label */}
            <h2 className='mb-2 text-3xl font-bold text-green-300'>
              {playerLabel} Scores!
            </h2>

            {/* Artist name */}
            {artistName && (
              <p className='text-xl text-green-200'>
                Target Artist:{' '}
                <span className='font-semibold'>{artistName}</span>
              </p>
            )}

            {/* Score text */}
            <p className='mt-4 text-lg text-green-100'>+1 Point</p>
          </div>
        </div>
      </div>
    </div>
  )
}
