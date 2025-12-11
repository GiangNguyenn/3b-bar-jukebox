'use client'

import React from 'react'

interface TurnTimerProps {
  timeRemaining: number
  totalTime?: number
  isActive: boolean
  isExpired: boolean
}

export function TurnTimer({
  timeRemaining,
  totalTime = 60,
  isActive,
  isExpired
}: TurnTimerProps): JSX.Element | null {
  if (!isActive && !isExpired) {
    return null
  }

  const progress = (timeRemaining / totalTime) * 100
  const circumference = 2 * Math.PI * 45 // radius = 45
  const strokeDashoffset = circumference - (progress / 100) * circumference

  // Determine color based on time remaining
  let color = '#10b981' // green
  if (isExpired) {
    color = '#ef4444' // red
  } else if (timeRemaining <= 15) {
    color = '#ef4444' // red
  } else if (timeRemaining <= 30) {
    color = '#f59e0b' // yellow/amber
  }

  return (
    <div className='flex flex-col items-center gap-2'>
      <div className='relative h-32 w-32'>
        {/* Background circle */}
        <svg className='h-full w-full -rotate-90 transform'>
          <circle
            cx='64'
            cy='64'
            r='45'
            stroke='currentColor'
            strokeWidth='8'
            fill='none'
            className='text-gray-700'
          />
          {/* Progress circle */}
          <circle
            cx='64'
            cy='64'
            r='45'
            stroke={color}
            strokeWidth='8'
            fill='none'
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={`transition-all duration-1000 ${
              timeRemaining <= 15 && !isExpired ? 'animate-pulse' : ''
            }`}
            strokeLinecap='round'
          />
        </svg>

        {/* Center text */}
        <div className='absolute inset-0 flex items-center justify-center'>
          {isExpired ? (
            <div className='text-center'>
              <div className='text-sm font-bold text-red-500'>TIME&apos;S</div>
              <div className='text-sm font-bold text-red-500'>UP!</div>
            </div>
          ) : (
            <div className='text-center'>
              <div className='text-4xl font-bold' style={{ color }}>
                {timeRemaining}
              </div>
              <div className='text-xs text-gray-400'>seconds</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
