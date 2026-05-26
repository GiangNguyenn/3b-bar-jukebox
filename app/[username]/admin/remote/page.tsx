'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { VoicePromptInput } from '../components/voice-prompt-input'
import {
  PRESET_PROMPTS,
  MAX_CUSTOM_PROMPT_LENGTH,
  truncatePrompt
} from '@/shared/constants/aiSuggestion'
import { useNowPlayingRealtime } from '@/hooks/useNowPlayingRealtime'

interface PromptState {
  presetId: string | null
  customPrompt: string
}

export default function RemotePage(): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined

  const [profileId, setProfileId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState>({
    presetId: null,
    customPrompt: ''
  })
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false)
  const [volume, setVolume] = useState(50)
  // Holds a save that arrived before profileId was ready
  const pendingRef = useRef<PromptState | null>(null)
  const textareaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Clear pending timers on unmount to prevent state updates on dead component
  useEffect(() => {
    return () => {
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current)
      if (textareaDebounceRef.current) clearTimeout(textareaDebounceRef.current)
    }
  }, [])

  // Now playing realtime subscription
  const { data: nowPlaying } = useNowPlayingRealtime({ profileId })

  const isPlaying = nowPlaying?.is_playing ?? false
  const trackName = nowPlaying?.item?.name ?? null
  const artistName = nowPlaying?.item?.artists?.[0]?.name ?? null

  const sendPlaybackAction = useCallback(
    async (
      action: 'play' | 'pause' | 'skip' | 'volume',
      extra?: { volumePercent?: number }
    ): Promise<void> => {
      if (!username) return
      setPlaybackError(null)
      setIsPlaybackLoading(true)
      try {
        const res = await fetch('/api/playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, username, ...extra })
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          if (body.error === 'player_unavailable') {
            setPlaybackError('Player is recovering, try again in a moment.')
          } else {
            setPlaybackError('Playback command failed.')
          }
        }
      } catch {
        setPlaybackError('Network error. Check your connection.')
      } finally {
        setIsPlaybackLoading(false)
      }
    },
    [username]
  )

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value)
      setVolume(value)
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current)
      volumeDebounceRef.current = setTimeout(() => {
        void sendPlaybackAction('volume', { volumePercent: value })
      }, 300)
    },
    [sendPlaybackAction]
  )

  return (
    <div className='flex min-h-screen flex-col gap-6 bg-black p-4 pb-16'>
      <header className='flex items-center justify-between'>
        <h1 className='text-white font-[family-name:var(--font-belgrano)] text-2xl'>
          Jukebox Remote
        </h1>
        <span className='text-xs text-muted-foreground'>
          {isSaving
            ? 'Saving…'
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString()}`
              : ''}
        </span>
      </header>

      {loadError && (
        <p className='rounded-md bg-red-950 px-4 py-3 text-sm text-red-400'>
          {loadError}
        </p>
      )}

      {/* Playback controls */}
      <section className='rounded-lg border border-border bg-card p-4'>
        <div className='mb-3'>
          {trackName ? (
            <>
              <p className='truncate text-sm font-semibold text-foreground'>
                {trackName}
              </p>
              <p className='truncate text-xs text-muted-foreground'>
                {artistName}
              </p>
            </>
          ) : (
            <p className='text-sm text-muted-foreground'>Nothing playing</p>
          )}
        </div>

        {playbackError && (
          <p className='mb-3 rounded-md bg-red-950 px-3 py-2 text-xs text-red-400'>
            {playbackError}
          </p>
        )}

        <div className='mb-4 flex gap-3'>
          <button
            type='button'
            disabled={isPlaybackLoading}
            onClick={() =>
              void sendPlaybackAction(isPlaying ? 'pause' : 'play')
            }
            className='flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type='button'
            disabled={isPlaybackLoading || !trackName}
            onClick={() => void sendPlaybackAction('skip')}
            className='flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Skip
          </button>
        </div>

        <div className='flex items-center gap-3'>
          <span className='w-4 text-xs text-muted-foreground'>
            <VolumeIcon />
          </span>
          <input
            type='range'
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            className='accent-primary flex-1'
          />
          <span className='w-6 text-right text-xs text-muted-foreground'>
            {volume}
          </span>
        </div>
      </section>

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

function VolumeIcon(): JSX.Element {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
      <path d='M19.07 4.93a10 10 0 0 1 0 14.14' />
      <path d='M15.54 8.46a5 5 0 0 1 0 7.07' />
    </svg>
  )
}
