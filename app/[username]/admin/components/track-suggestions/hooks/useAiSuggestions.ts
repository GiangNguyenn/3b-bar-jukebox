'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { type RealtimeChannel } from '@supabase/supabase-js'
import { type AiSuggestionsState } from '@/shared/types/aiSuggestions'
import {
  PRESET_PROMPTS,
  AI_SUGGESTIONS_STORAGE_KEY,
  deriveActivePrompt,
  truncatePrompt
} from '@/shared/constants/aiSuggestion'
import { supabaseBrowser } from '@/lib/supabase-browser'

const DEFAULT_STATE: AiSuggestionsState = {
  selectedPresetId: PRESET_PROMPTS[0]?.id ?? null,
  customPrompt: '',
  autoFillTargetSize: 10
}

function loadFromLocalStorage(): AiSuggestionsState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  const saved = localStorage.getItem(AI_SUGGESTIONS_STORAGE_KEY)
  if (!saved) return DEFAULT_STATE
  try {
    return { ...DEFAULT_STATE, ...(JSON.parse(saved) as AiSuggestionsState) }
  } catch {
    return DEFAULT_STATE
  }
}

function stateFromProfile(row: {
  ai_prompt_preset_id: string | null
  ai_custom_prompt: string | null
  ai_autofill_target_size: number | null
}): AiSuggestionsState {
  return {
    selectedPresetId: row.ai_prompt_preset_id ?? DEFAULT_STATE.selectedPresetId,
    customPrompt: row.ai_custom_prompt ?? DEFAULT_STATE.customPrompt,
    autoFillTargetSize:
      row.ai_autofill_target_size ?? DEFAULT_STATE.autoFillTargetSize
  }
}

export interface UseAiSuggestionsReturn {
  state: AiSuggestionsState
  activePrompt: string
  selectPreset: (presetId: string) => void
  setCustomPrompt: (prompt: string) => void
  setAutoFillTargetSize: (size: number) => void
}

export function useAiSuggestions(): UseAiSuggestionsReturn {
  const [state, setState] = useState<AiSuggestionsState>(loadFromLocalStorage)
  const [profileId, setProfileId] = useState<string | null>(null)
  const stateRef = useRef(state)
  const lastSavedStateRef = useRef<string>('')
  // Records the exact values last written to Supabase so we can skip our own Realtime echo
  const lastWrittenRef = useRef<AiSuggestionsState | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Load profile ID and hydrate state from Supabase
  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      const {
        data: { user }
      } = await supabaseBrowser.auth.getUser()
      if (!user || cancelled) return

      setProfileId(user.id)

      const { data } = await supabaseBrowser
        .from('profiles')
        .select(
          'ai_prompt_preset_id, ai_custom_prompt, ai_autofill_target_size'
        )
        .eq('id', user.id)
        .single()

      if (!data || cancelled) return

      // Only hydrate if at least one AI column has been set (not a brand-new profile)
      const hasSupabaseData =
        data.ai_prompt_preset_id !== null ||
        data.ai_custom_prompt !== null ||
        data.ai_autofill_target_size !== null

      if (hasSupabaseData) {
        setState(stateFromProfile(data))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Subscribe to Realtime changes so other devices (e.g. phone remote page) are reflected here
  useEffect(() => {
    if (!profileId) return

    let channel: RealtimeChannel | null = null

    channel = supabaseBrowser
      .channel(`profile-prompt:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${profileId}`
        },
        (payload) => {
          const row = payload.new as {
            ai_prompt_preset_id: string | null
            ai_custom_prompt: string | null
            ai_autofill_target_size: number | null
          }
          const last = lastWrittenRef.current
          // Skip only if this payload exactly matches what we just wrote — our own echo
          if (
            last !== null &&
            row.ai_prompt_preset_id === last.selectedPresetId &&
            row.ai_custom_prompt === last.customPrompt &&
            row.ai_autofill_target_size === last.autoFillTargetSize
          ) {
            lastWrittenRef.current = null
            return
          }
          setState(stateFromProfile(row))
        }
      )
      .subscribe()

    return () => {
      void supabaseBrowser.removeChannel(channel)
    }
  }, [profileId])

  // Persist state: debounced write to Supabase + immediate localStorage fallback
  useEffect((): (() => void) => {
    const currentState = JSON.stringify(state)
    if (currentState === lastSavedStateRef.current) return () => {}

    // Always write localStorage immediately (offline resilience)
    localStorage.setItem(AI_SUGGESTIONS_STORAGE_KEY, currentState)
    lastSavedStateRef.current = currentState

    if (!profileId) return () => {}

    const timeoutId = setTimeout(() => {
      // Record what we're writing so the Realtime handler can recognise our own echo
      lastWrittenRef.current = {
        selectedPresetId: state.selectedPresetId,
        customPrompt: state.customPrompt,
        autoFillTargetSize: state.autoFillTargetSize
      }
      void supabaseBrowser
        .from('profiles')
        .update({
          ai_prompt_preset_id: state.selectedPresetId,
          ai_custom_prompt: state.customPrompt,
          ai_autofill_target_size: state.autoFillTargetSize
        })
        .eq('id', profileId)
    }, 1000)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [state, profileId])

  const activePrompt = deriveActivePrompt(
    state.selectedPresetId,
    state.customPrompt
  )

  const selectPreset = useCallback((presetId: string): void => {
    const preset = PRESET_PROMPTS.find((p) => p.id === presetId)
    setState((prev) => ({
      ...prev,
      selectedPresetId: presetId,
      customPrompt: preset?.prompt ?? prev.customPrompt
    }))
  }, [])

  const setCustomPrompt = useCallback((prompt: string): void => {
    setState((prev) => ({
      ...prev,
      customPrompt: truncatePrompt(prompt)
    }))
  }, [])

  const setAutoFillTargetSize = useCallback((size: number): void => {
    setState((prev) => ({ ...prev, autoFillTargetSize: size }))
  }, [])

  return {
    state,
    activePrompt,
    selectPreset,
    setCustomPrompt,
    setAutoFillTargetSize
  }
}
