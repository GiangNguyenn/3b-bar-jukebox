import { type RecoveryState } from '@/hooks/recovery/useRecoverySystem'

interface RecoveryStatusProps {
  state: RecoveryState
}

export function RecoveryStatus({ state }: RecoveryStatusProps): JSX.Element {
  if (state.phase === 'idle') return null

  return (
    <div className="fixed top-4 right-4 z-50">
      <div className="rounded-lg bg-gray-900/90 p-4 text-white shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">{state.currentStep}</span>
          <span className="text-sm text-gray-400">
            {Math.round(state.progress * 100)}%
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="absolute left-0 top-0 h-full bg-green-500 transition-all duration-300 ease-linear"
            style={{ width: `${state.progress * 100}%` }}
          />
        </div>
        {state.error && (
          <div className="mt-2 text-sm text-red-400">{state.error}</div>
        )}
      </div>
    </div>
  )
} 