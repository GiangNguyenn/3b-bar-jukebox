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
  // Don't show anything if not recovering and no message
  if (!isRecovering && !message) {
    return null
  }

  const percent = Math.round((progress ?? 0) * 100)
  const isSuccess = !isRecovering && message.includes('completed successfully')
  const isError = !isRecovering && message.includes('failed')

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 p-4 ${
        isSuccess
          ? 'bg-green-900/90'
          : isError
            ? 'bg-red-900/90'
            : 'bg-black/90'
      }`}
    >
      <div className='mx-auto max-w-xl'>
        <div className='mb-2 flex items-center justify-between'>
          <span className='text-white text-sm font-medium'>{message}</span>
          {isRecovering && (
            <span className='text-white/60 text-sm'>{percent}%</span>
          )}
        </div>
        {isRecovering && <Progress value={percent} className='h-2' />}
        {isRecovering && (
          <div className='mt-1 text-right'>
            <span className='text-white/60 text-xs'>{currentStep}</span>
          </div>
        )}
      </div>
    </div>
  )
}
