'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { VoicePromptInput } from '../components/voice-prompt-input'
import { TACTILE_BUTTON_BASE } from '../components/tactile-button'
import {
  PRESET_PROMPTS,
  MAX_CUSTOM_PROMPT_LENGTH,
  truncatePrompt
} from '@/shared/constants/aiSuggestion'
import { useNowPlayingRealtime } from '@/hooks/useNowPlayingRealtime'
import type {
  RemoteCommand,
  RemoteCommandEnvelope,
  RemoteCommandResult
} from '@/hooks/useRemoteCommandListener'

// How long to wait for the laptop's ack before assuming it never saw the
// command — long enough to tolerate normal network/relay latency, short
// enough that a real problem shows up quickly.
const COMMAND_ACK_TIMEOUT_MS = 5000

function makeCommandId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const PLAYBACK_BUTTON_CLASS = cn(
  TACTILE_BUTTON_BASE,
  'flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground',
  'hover:bg-muted hover:shadow active:bg-muted',
  'disabled:cursor-not-allowed disabled:opacity-50'
)

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
  const [volume, setVolume] = useState(50)
  const [commandError, setCommandError] = useState<string | null>(null)
  const broadcastChannelRef = useRef<ReturnType<
    typeof supabaseBrowser.channel
  > | null>(null)
  // Holds a save that arrived before profileId was ready
  const pendingRef = useRef<PromptState | null>(null)
  const textareaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commandErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  // Commands awaiting a 'command_result' ack, keyed by id, with their
  // no-response timeout so we can tell "the laptop is unreachable right
  // now" apart from silence that just means everything's fine.
  const pendingCommandsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  // Show a command failure (from a send that didn't reach the laptop, or an
  // ack reporting it failed there) for a few seconds, then clear it.
  const flashCommandError = useCallback((message: string) => {
    setCommandError(message)
    if (commandErrorTimeoutRef.current)
      clearTimeout(commandErrorTimeoutRef.current)
    commandErrorTimeoutRef.current = setTimeout(
      () => setCommandError(null),
      4000
    )
  }, [])

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

  // Open a broadcast channel to send commands to the admin page (laptop),
  // and listen on the same channel for its ack of whether each one worked —
  // the laptop is the only side that knows if the Spotify call actually
  // succeeded, so without this the phone has no way to find out.
  useEffect(() => {
    if (!profileId) return
    const ch = supabaseBrowser
      .channel(`remote_commands_${profileId}`)
      .on(
        'broadcast',
        { event: 'command_result' },
        ({ payload }: { payload: RemoteCommandResult }) => {
          const timeoutId = pendingCommandsRef.current.get(payload.id)
          if (timeoutId) {
            clearTimeout(timeoutId)
            pendingCommandsRef.current.delete(payload.id)
          }
          if (!payload.ok) {
            flashCommandError(payload.error ?? 'Command failed.')
          }
        }
      )
    ch.subscribe()
    broadcastChannelRef.current = ch
    return () => {
      void supabaseBrowser.removeChannel(ch)
      broadcastChannelRef.current = null
    }
  }, [profileId, flashCommandError])

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
    const pendingCommands = pendingCommandsRef.current
    return () => {
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current)
      if (textareaDebounceRef.current) clearTimeout(textareaDebounceRef.current)
      if (commandErrorTimeoutRef.current)
        clearTimeout(commandErrorTimeoutRef.current)
      pendingCommands.forEach((timeoutId) => clearTimeout(timeoutId))
      pendingCommands.clear()
    }
  }, [])

  // Now playing realtime subscription
  const { data: nowPlaying } = useNowPlayingRealtime({ profileId })

  const isPlaying = nowPlaying?.is_playing ?? false
  const trackName = nowPlaying?.item?.name ?? null
  const artistName = nowPlaying?.item?.artists?.[0]?.name ?? null

  const sendPlaybackAction = useCallback(
    (
      action: RemoteCommand['action'],
      extra?: { volumePercent?: number }
    ): void => {
      const ch = broadcastChannelRef.current
      if (!ch) {
        flashCommandError('Not connected yet — try again in a moment.')
        return
      }

      const id = makeCommandId()
      const envelope: RemoteCommandEnvelope = {
        id,
        command: { action, ...extra } as RemoteCommand
      }

      const timeoutId = setTimeout(() => {
        pendingCommandsRef.current.delete(id)
        flashCommandError(
          'No response from the jukebox player — make sure /admin is open and in the foreground on the laptop.'
        )
      }, COMMAND_ACK_TIMEOUT_MS)
      pendingCommandsRef.current.set(id, timeoutId)

      void ch
        .send({
          type: 'broadcast',
          event: 'command',
          payload: envelope
        })
        .then((status) => {
          // 'ok' means it reached the relay; the laptop still acks (or not)
          // via the 'command_result' listener above — or the timeout fires
          // if it never does.
          if (status !== 'ok') {
            clearTimeout(timeoutId)
            pendingCommandsRef.current.delete(id)
            flashCommandError('Command failed to send. Check your connection.')
          }
        })
    },
    [flashCommandError]
  )

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value)
      setVolume(value)
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current)
      volumeDebounceRef.current = setTimeout(() => {
        sendPlaybackAction('volume', { volumePercent: value })
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

      {commandError && (
        <p className='rounded-md bg-red-950 px-4 py-3 text-sm text-red-400'>
          {commandError}
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

        <div className='mb-4 flex gap-3'>
          <button
            type='button'
            onClick={() => sendPlaybackAction(isPlaying ? 'pause' : 'play')}
            className={PLAYBACK_BUTTON_CLASS}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type='button'
            disabled={!trackName}
            onClick={() => sendPlaybackAction('skip')}
            className={PLAYBACK_BUTTON_CLASS}
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
              className={cn(
                TACTILE_BUTTON_BASE,
                'rounded-md border px-3 py-2 text-left text-sm font-medium',
                prompt.presetId === preset.id
                  ? 'border-primary bg-primary/10 text-primary shadow-primary/10 shadow-sm'
                  : 'border-border bg-background text-foreground hover:bg-muted hover:shadow'
              )}
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
