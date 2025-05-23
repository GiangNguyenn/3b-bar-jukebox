import { Progress } from '@/components/ui/progress'

interface RecoveryStatusProps {
  isRecovering: boolean
  message: string
  phase: 'idle' | 'recovering' | 'success' | 'error'
}

export function RecoveryStatus({
  isRecovering,
  message,
  phase
}: RecoveryStatusProps): JSX.Element | null {
  if (!isRecovering) {
    return null
  }

  // Calculate progress based on phase
  const progress = phase === 'recovering' ? 50 : phase === 'success' ? 100 : 0

  return (
    <div className='fixed bottom-0 left-0 right-0 z-50 bg-black/90 p-4'>
      <div className='mx-auto max-w-xl'>
        <div className='mb-2 flex items-center justify-between'>
          <span className='text-white text-sm font-medium'>{message}</span>
          <span className='text-white/60 text-sm'>{progress}%</span>
        </div>
        <Progress value={progress} className='h-2' />
        <div className='mt-1 text-right'>
          <span className='text-white/60 text-xs'>
            {phase === 'recovering'
              ? 'Recovering...'
              : phase === 'success'
                ? 'Success'
                : 'Error'}
          </span>
        </div>
      </div>
    </div>
  )
}
