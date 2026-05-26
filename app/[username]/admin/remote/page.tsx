'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { VoicePromptInput } from '../components/voice-prompt-input'
import {
  PRESET_PROMPTS,
  MAX_CUSTOM_PROMPT_LENGTH,
  truncatePrompt
} from '@/shared/constants/aiSuggestion'

interface PromptState {
  presetId: string | null
  customPrompt: string
}

export default function RemotePage(): JSX.Element {
  const [profileId, setProfileId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState>({
    presetId: null,
    customPrompt: ''
  })
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Holds a save that arrived before profileId was ready
  const pendingRef = useRef<PromptState | null>(null)
  const textareaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load current prompt from Supabase
  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      const {
        data: { user }
      } = await supabaseBrowser.auth.getUser()
      if (!user || cancelled) return
      setProfileId(user.id)

      const { data, error } = await supabaseBrowser
        .from('profiles')
        .select('ai_prompt_preset_id, ai_custom_prompt')
        .eq('id', user.id)
        .single()

      if (cancelled) return
      if (error) {
        setLoadError('Could not load current prompt.')
        return
      }
      setPrompt({
        presetId: data.ai_prompt_preset_id ?? null,
        customPrompt: data.ai_custom_prompt ?? ''
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(
    async (next: PromptState) => {
      if (!profileId) {
        // Queue the latest value — flushed once profileId loads
        pendingRef.current = next
        return
      }
      setIsSaving(true)
      await supabaseBrowser
        .from('profiles')
        .update({
          ai_prompt_preset_id: next.presetId,
          ai_custom_prompt: next.customPrompt
        })
        .eq('id', profileId)
      setIsSaving(false)
      setSavedAt(new Date())
    },
    [profileId]
  )

  // Flush any save that arrived before profileId was ready
  useEffect(() => {
    if (!profileId || !pendingRef.current) return
    const pending = pendingRef.current
    pendingRef.current = null
    void save(pending)
  }, [profileId, save])

  const handleCustomPromptChange = useCallback(
    (value: string) => {
      const next: PromptState = {
        presetId: null,
        customPrompt: truncatePrompt(value)
      }
      setPrompt(next)
      void save(next)
    },
    [save]
  )

  const handlePresetSelect = useCallback(
    (presetId: string) => {
      const preset = PRESET_PROMPTS.find((p) => p.id === presetId)
      const next: PromptState = {
        presetId,
        customPrompt: preset?.prompt ?? ''
      }
      setPrompt(next)
      void save(next)
    },
    [save]
  )

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      const next: PromptState = {
        presetId: null,
        customPrompt: truncatePrompt(value)
      }
      setPrompt(next)
      // Debounce Supabase writes — state updates immediately for UI responsiveness
      if (textareaDebounceRef.current) clearTimeout(textareaDebounceRef.current)
      textareaDebounceRef.current = setTimeout(() => {
        void save(next)
      }, 500)
    },
    [save]
  )

  return (
    <div className='flex min-h-screen flex-col gap-6 bg-black p-4 pb-16'>
      <header className='flex items-center justify-between'>
        <h1 className='font-[family-name:var(--font-belgrano)] text-2xl text-white'>
          Jukebox Remote
        </h1>
        <span className='text-xs text-muted-foreground'>
          {isSaving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ''}
        </span>
      </header>

      {loadError && (
        <p className='rounded-md bg-red-950 px-4 py-3 text-sm text-red-400'>
          {loadError}
        </p>
      )}

      {/* Voice input */}
      <section className='rounded-lg border border-border bg-card p-4'>
        <h2 className='mb-3 text-base font-semibold text-foreground'>
          Speak the vibe
        </h2>
        <VoicePromptInput
          onTranscript={handleCustomPromptChange}
          mode='replace'
          currentValue={prompt.customPrompt}
        />
        {prompt.customPrompt && (
          <p className='mt-3 rounded-md bg-muted px-3 py-2 text-sm text-foreground'>
            {prompt.customPrompt}
          </p>
        )}
      </section>

      {/* Manual text entry */}
      <section className='rounded-lg border border-border bg-card p-4'>
        <h2 className='mb-3 text-base font-semibold text-foreground'>
          Or type it
        </h2>
        <textarea
          value={prompt.customPrompt}
          onChange={handleTextareaChange}
          placeholder='Describe the vibe, e.g. "Upbeat jazz with heavy bass"'
          rows={4}
          className='focus:border-primary focus:ring-primary w-full resize-none rounded-md border border-border bg-background p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1'
        />
        <p className='mt-1 text-right text-xs text-muted-foreground'>
          {prompt.customPrompt.length}/{MAX_CUSTOM_PROMPT_LENGTH}
        </p>
      </section>

      {/* Quick presets */}
      <section className='rounded-lg border border-border bg-card p-4'>
        <h2 className='mb-3 text-base font-semibold text-foreground'>
          Quick presets
        </h2>
        <div className='grid grid-cols-2 gap-2'>
          {PRESET_PROMPTS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              onClick={() => handlePresetSelect(preset.id)}
              className={[
                'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                prompt.presetId === preset.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              ].join(' ')}
            >
              {preset.emoji} {preset.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
