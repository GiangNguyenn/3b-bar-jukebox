'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { type AiSuggestionsState } from '@/shared/types/aiSuggestions'
import {
  PRESET_PROMPTS,
  AI_SUGGESTIONS_STORAGE_KEY,
  deriveActivePrompt,
  truncatePrompt
} from '@/shared/constants/aiSuggestion'

const getInitialState = (): AiSuggestionsState => {
  const defaultState: AiSuggestionsState = {
    selectedPresetId: PRESET_PROMPTS[0]?.id ?? null,
    customPrompt: '',
    autoFillTargetSize: 10
  }

  if (typeof window === 'undefined') {
    return defaultState
  }

  const savedState = localStorage.getItem(AI_SUGGESTIONS_STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as AiSuggestionsState
      return {
        ...defaultState,
        ...parsed
      }
    } catch {
      // Fall back to defaults on parse failure
    }
  }

  return defaultState
}

export interface UseAiSuggestionsReturn {
  state: AiSuggestionsState
  activePrompt: string
  selectPreset: (presetId: string) => void
  setCustomPrompt: (prompt: string) => void
  setAutoFillTargetSize: (size: number) => void
}

export function useAiSuggestions(): UseAiSuggestionsReturn {
  const [state, setState] = useState<AiSuggestionsState>(getInitialState)
  const stateRef = useRef(state)
  const lastSavedStateRef = useRef<string>('')

  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Persist state to localStorage with 1-second debounce
  // Also save immediately on unmount so switching tabs doesn't lose changes
  useEffect((): (() => void) => {
    const currentState = JSON.stringify(state)
    if (currentState === lastSavedStateRef.current) return () => {}

    const timeoutId = setTimeout(() => {
      localStorage.setItem(AI_SUGGESTIONS_STORAGE_KEY, currentState)
      lastSavedStateRef.current = currentState
    }, 1000)

    return () => {
      clearTimeout(timeoutId)
      // Save immediately on cleanup (tab switch / unmount)
      localStorage.setItem(AI_SUGGESTIONS_STORAGE_KEY, currentState)
      lastSavedStateRef.current = currentState
    }
  }, [state])

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
