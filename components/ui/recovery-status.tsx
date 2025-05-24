import { Progress } from '@/components/ui/progress'

interface RecoveryStatusProps {
  isRecovering: boolean
  message: string
  progress: number // 0-1
  currentStep: string
}

export function RecoveryStatus({
  isRecovering,
  message,
  progress,
  currentStep
}: RecoveryStatusProps): JSX.Element | null {
  if (!isRecovering) {
    return null
  }

  const percent = Math.round((progress ?? 0) * 100)

  return (
    <div className='fixed bottom-0 left-0 right-0 z-50 bg-black/90 p-4'>
      <div className='mx-auto max-w-xl'>
        <div className='mb-2 flex items-center justify-between'>
          <span className='text-white text-sm font-medium'>{message}</span>
          <span className='text-white/60 text-sm'>{percent}%</span>
        </div>
        <Progress value={percent} className='h-2' />
        <div className='mt-1 text-right'>
          <span className='text-white/60 text-xs'>{currentStep}</span>
        </div>
      </div>
    </div>
  )
}
