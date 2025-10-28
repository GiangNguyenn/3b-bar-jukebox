'use client'

import { memo } from 'react'
import type { ReactElement } from 'react'
import type { ColorPalette } from '@/shared/utils/colorExtraction'

interface ProgressRingProps {
  progress: number // 0-100
  duration: number // in ms
  isPlaying: boolean
  colors: ColorPalette
  size?: number
}

function ProgressRing({
  progress,
  duration,
  isPlaying,
  colors,
  size = 200
}: ProgressRingProps): ReactElement {
  const circumference = 2 * Math.PI * (size / 2 - 10)
  const strokeDashoffset = circumference - (progress / 100) * circumference

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const elapsed = (duration * progress) / 100
  const remaining = duration - elapsed

  return (
    <div className='relative flex items-center justify-center sm:h-40 sm:w-40 md:h-48 md:w-48 lg:h-56 lg:w-56'>
      <svg
        width={size}
        height={size}
        className='-rotate-90 transform'
        viewBox={`0 0 ${size} ${size}`}
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 10}
          stroke={colors.background}
          strokeWidth='8'
          fill='none'
          opacity='0.2'
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 10}
          stroke={colors.dominant}
          strokeWidth='8'
          fill='none'
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            filter: `drop-shadow(0 0 8px ${colors.dominant})`,
            transition: 'stroke-dashoffset 0.1s ease-out'
          }}
        />
      </svg>

      {/* Center content */}
      <div className='absolute text-center'>
        {isPlaying && (
          <div
            className='mb-1 text-2xl sm:mb-2 sm:text-3xl md:text-4xl'
            style={{ color: colors.dominant }}
          >
            ♪
          </div>
        )}
        <div
          className='text-lg font-bold sm:text-xl md:text-2xl'
          style={{ color: colors.foreground }}
        >
          {formatTime(elapsed)}
        </div>
        <div
          className='text-xs opacity-60 sm:text-sm'
          style={{ color: colors.foreground }}
        >
          {formatTime(remaining)}
        </div>
      </div>
    </div>
  )
}

export default memo(ProgressRing)
