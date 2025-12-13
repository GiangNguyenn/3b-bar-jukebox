'use client'

interface LoadingProgressBarProps {
  progress: number
  stage: string
}

export function LoadingProgressBar({
  progress,
  stage
}: LoadingProgressBarProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, progress))

  return (
    <div className='mx-auto flex w-full max-w-lg items-center justify-center gap-4 rounded-lg border border-blue-500/30 bg-blue-950/20 px-6 py-4'>
      <div className='flex w-full flex-col gap-2'>
        <div className='flex items-center justify-between text-xs'>
          <span className='font-medium text-blue-300'>{stage}</span>
          <span className='text-blue-400/70'>{clamped}%</span>
        </div>
        <div className='h-2 w-full overflow-hidden rounded-full bg-blue-950/50'>
          <div
            className='h-full rounded-full bg-blue-500 transition-all duration-500 ease-out'
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
    </div>
  )
}
