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
    <div className="fixed top-0 left-0 right-0 z-50 bg-black/90 p-4">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-white">
            {message}
          </span>
          <span className="text-sm text-white/60">
            {progress}%
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>
    </div>
  )
} 