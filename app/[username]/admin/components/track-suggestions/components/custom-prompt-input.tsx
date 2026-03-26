'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MAX_CUSTOM_PROMPT_LENGTH } from '@/shared/constants/aiSuggestion'

interface CustomPromptInputProps {
  customPrompt: string
  onCustomPromptChange: (prompt: string) => void
}

export function CustomPromptInput({
  customPrompt,
  onCustomPromptChange
}: CustomPromptInputProps): JSX.Element {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    if (value.length <= MAX_CUSTOM_PROMPT_LENGTH) {
      onCustomPromptChange(value)
    } else {
      onCustomPromptChange(value.slice(0, MAX_CUSTOM_PROMPT_LENGTH))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>
          Tell me what type of music you want to hear
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <textarea
          value={customPrompt}
          onChange={handleChange}
          placeholder='Describe the vibe you want, e.g. "Upbeat jazz fusion with funky bass lines"'
          rows={3}
          className='focus:border-primary focus:ring-primary w-full resize-none rounded-md border border-border bg-background p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1'
        />
        <p className='text-right text-xs text-muted-foreground'>
          {customPrompt.length}/{MAX_CUSTOM_PROMPT_LENGTH}
        </p>
      </CardContent>
    </Card>
  )
}
