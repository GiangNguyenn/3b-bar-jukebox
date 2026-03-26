'use client'

import { useState, useEffect } from 'react'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { useAiSuggestions } from './hooks/useAiSuggestions'
import { PresetPromptSelector } from './components/preset-prompt-selector'
import { CustomPromptInput } from './components/custom-prompt-input'
import { AutoFillTargetSelector } from './components/auto-fill-target-selector'
import { Toast } from '@/components/ui'

interface TrackSuggestionsTabProps {
  onStateChange?: (state: { activePrompt: string; autoFillTargetSize: number }) => void
}

interface AiSuggestionTrack {
  id: string
  title: string
  artist: string
}

export function TrackSuggestionsTab({
  onStateChange
}: TrackSuggestionsTabProps): JSX.Element {
  const {
    state,
    activePrompt,
    selectPreset,
    setCustomPrompt,
    setAutoFillTargetSize
  } = useAiSuggestions()

  const { addLog } = useConsoleLogsContext()

  const [isLoading, setIsLoading] = useState(false)
  const [suggestedTracks, setSuggestedTracks] = useState<AiSuggestionTrack[]>([])
  const [toast, setToast] = useState<{
    message: string
    variant: 'success' | 'warning' | 'info'
  } | null>(null)

  const showToast = (
    message: string,
    variant: 'success' | 'warning' | 'info' = 'success'
  ): void => {
    setToast({ message, variant })
  }

  // Propagate state changes to parent
  useEffect(() => {
    if (onStateChange) {
      onStateChange({ activePrompt, autoFillTargetSize: state.autoFillTargetSize })
    }
  }, [activePrompt, state.autoFillTargetSize, onStateChange])

  const handleTestAiSuggestion = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/ai-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: activePrompt,
          excludedTrackIds: [],
          profileId: 'test'
        })
      })

      const data = (await response.json()) as {
        success: boolean
        tracks?: Array<{ id: string; title: string; artist: string }>
        error?: string
      }

      if (data.success && data.tracks && data.tracks.length > 0) {
        setSuggestedTracks(data.tracks)
        showToast(`Found ${data.tracks.length} tracks`)
        addLog('INFO', `AI suggestion test: ${data.tracks.length} tracks returned`, 'TrackSuggestionsTab')
      } else {
        showToast(data.error ?? 'No tracks returned from AI suggestion', 'warning')
        addLog('WARN', `AI suggestion test failed: ${data.error ?? 'no tracks'}`, 'TrackSuggestionsTab')
      }
    } catch (error) {
      showToast('An unexpected error occurred', 'warning')
      addLog(
        'ERROR',
        'AI suggestion test error',
        'TrackSuggestionsTab',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsLoading(false)
    }
  }

  const buttonBaseClass =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
  const primaryButtonClass = `${buttonBaseClass} bg-primary text-primary-foreground shadow hover:bg-primary/90 px-8 py-2 text-lg`

  return (
    <div className='relative mx-auto max-w-2xl space-y-6'>
      {/* Toast Notification Overlay */}
      {toast && (
        <div className='fixed bottom-4 right-4 z-[100] animate-in fade-in slide-in-from-bottom-5'>
          <Toast
            message={toast.message}
            variant={toast.variant}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <div className='flex flex-col gap-6'>
        <PresetPromptSelector
          selectedPresetId={state.selectedPresetId}
          onSelectPreset={selectPreset}
        />

        <CustomPromptInput
          customPrompt={state.customPrompt}
          onCustomPromptChange={setCustomPrompt}
        />

        <AutoFillTargetSelector
          targetSize={state.autoFillTargetSize}
          onTargetSizeChange={setAutoFillTargetSize}
        />

        <button
          onClick={() => {
            void handleTestAiSuggestion()
          }}
          disabled={isLoading || !activePrompt}
          className={`${primaryButtonClass} w-full`}
        >
          <SparklesIcon className='mr-2 h-5 w-5' />
          {isLoading ? 'Asking AI...' : 'Test AI Suggestion'}
        </button>

        {suggestedTracks.length > 0 && (
          <div className='space-y-4'>
            <h3 className='text-lg font-medium'>
              AI Suggested Tracks ({suggestedTracks.length})
            </h3>
            <div className='space-y-2'>
              {suggestedTracks.map((track, index) => (
                <div
                  key={track.id}
                  className='flex items-center gap-3 rounded-lg border bg-muted p-3'
                >
                  <span className='text-sm font-medium text-muted-foreground'>
                    {index + 1}
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>{track.title}</p>
                    <p className='truncate text-xs text-muted-foreground'>
                      {track.artist}
                    </p>
                  </div>
                  <span className='shrink-0 font-mono text-xs text-muted-foreground'>
                    {track.id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
