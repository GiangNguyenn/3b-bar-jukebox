import { useState, useEffect, useRef, useCallback } from 'react'
import { FALLBACK_GENRES, type Genre } from '@/shared/constants/trackSuggestion'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const STORAGE_KEY = 'track-suggestions-state'

const getInitialState = (
  initialState?: Partial<TrackSuggestionsState>
): TrackSuggestionsState => {
  const defaultState: TrackSuggestionsState = {
    genres: [...FALLBACK_GENRES.slice(0, 10)],
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    maxSongLength: 10,
    autoFillTargetSize: 10,
    allowExplicit: true,
    maxOffset: 50,
    ...initialState
  }

  if (typeof window === 'undefined') {
    return defaultState
  }

  const savedState = localStorage.getItem(STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as TrackSuggestionsState
      return {
        ...defaultState,
        ...parsed
      }
    } catch (error) {
      console.error('[TrackSuggestions] Failed to parse localStorage:', error)
    }
  }

  return defaultState
}

interface UseTrackSuggestionsReturn {
  state: TrackSuggestionsState
  updateState: (newState: Partial<TrackSuggestionsState>) => void
  setGenres: (genres: Genre[]) => void
  setYearRange: (yearRange: [number, number]) => void
  setPopularity: (popularity: number) => void
  setMaxSongLength: (maxSongLength: number) => void
  setAutoFillTargetSize: (autoFillTargetSize: number) => void
}

export function useTrackSuggestions(
  initialState?: Partial<TrackSuggestionsState>
): UseTrackSuggestionsReturn {
  const [state, setState] = useState<TrackSuggestionsState>(() => {
    const initialTrackState = getInitialState(initialState)
    return initialTrackState
  })
  const stateRef = useRef(state)
  const lastSavedStateRef = useRef<string>('')

  // Update ref when state changes
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Persist state changes to localStorage with debouncing
  useEffect((): (() => void) => {
    const currentState = JSON.stringify(state)
    if (currentState === lastSavedStateRef.current) return () => {}

    const timeoutId = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, currentState)
      lastSavedStateRef.current = currentState
    }, 1000) // Debounce for 1 second

    return () => clearTimeout(timeoutId)
  }, [state])

  const updateState = useCallback(
    (newState: Partial<TrackSuggestionsState>): void => {
      setState((prev) => ({ ...prev, ...newState }))
    },
    []
  )

  const setGenres = useCallback(
    (genres: Genre[]): void => {
      updateState({ genres })
    },
    [updateState]
  )

  const setYearRange = useCallback(
    (yearRange: [number, number]): void => {
      updateState({ yearRange })
    },
    [updateState]
  )

  const setPopularity = useCallback(
    (popularity: number): void => {
      updateState({ popularity })
    },
    [updateState]
  )

  const setMaxSongLength = useCallback(
    (maxSongLength: number): void => {
      updateState({ maxSongLength })
    },
    [updateState]
  )

  const setAutoFillTargetSize = useCallback(
    (autoFillTargetSize: number): void => {
      updateState({ autoFillTargetSize })
    },
    [updateState]
  )

  return {
    state,
    updateState,
    setGenres,
    setYearRange,
    setPopularity,
    setMaxSongLength,
    setAutoFillTargetSize
  }
}
