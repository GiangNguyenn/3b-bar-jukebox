'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PRESET_PROMPTS } from '@/shared/constants/aiSuggestion'

interface PresetPromptSelectorProps {
  selectedPresetId: string | null
  onSelectPreset: (presetId: string) => void
}

export function PresetPromptSelector({
  selectedPresetId,
  onSelectPreset
}: PresetPromptSelectorProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>Music Vibe</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4'>
          {PRESET_PROMPTS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              onClick={() => onSelectPreset(preset.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                selectedPresetId === preset.id
                  ? 'border-primary bg-primary/10 ring-primary ring-1'
                  : 'hover:border-primary/50 border-border'
              }`}
            >
              <span className='text-xl'>{preset.emoji}</span>
              <span className='ml-2 text-sm font-medium'>{preset.label}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
