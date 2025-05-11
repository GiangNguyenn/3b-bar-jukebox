import { Progress } from '@/components/ui/progress'

interface RecoveryStatusProps {
  isRecovering: boolean
  message: string
  progress: number
}

export function RecoveryStatus({
  isRecovering,
  message,
  progress
}: RecoveryStatusProps): JSX.Element | null {
  if (!isRecovering) {
    return null
  }

  return (
    <div className='fixed left-0 right-0 top-0 z-50 bg-black/90 p-4'>
      <div className='mx-auto max-w-xl'>
        <div className='mb-2 flex items-center justify-between'>
          <span className='text-white text-sm font-medium'>{message}</span>
          <span className='text-white/60 text-sm'>{progress}%</span>
        </div>
        <Progress value={progress} className='h-2' />
      </div>
    </div>
  )
}
