'use client'

interface PlaybackProgressProps {
  progress: number
  duration_ms: number
  formatTime: (ms: number) => string
}

export function PlaybackProgress({
  progress,
  duration_ms,
  formatTime
}: PlaybackProgressProps): JSX.Element {
  return (
    <div className='space-y-1'>
      <div className='relative h-1.5 overflow-hidden rounded-full bg-gray-700'>
        <div
          className='absolute left-0 top-0 h-full bg-green-500 transition-all duration-1000 ease-linear'
          style={{
            width: `${(progress / duration_ms) * 100}%`
          }}
        />
      </div>
      <div className='flex justify-between text-xs text-gray-500'>
        <span>{formatTime(progress)}</span>
        <span>{formatTime(duration_ms)}</span>
      </div>
    </div>
  )
}
