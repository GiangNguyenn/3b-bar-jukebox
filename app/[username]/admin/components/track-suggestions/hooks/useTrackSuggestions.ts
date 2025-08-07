import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FALLBACK_GENRES,
  type Genre,
  DEFAULT_MAX_OFFSET
} from '@/shared/constants/trackSuggestion'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const STORAGE_KEY = 'track-suggestions-state'

const getInitialState = (
  initialState?: Partial<TrackSuggestionsState>
): TrackSuggestionsState => {
  const defaultState: TrackSuggestionsState = {
    genres: [...FALLBACK_GENRES.slice(0, 10)],
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 10,
    songsBetweenRepeats: 50,
    maxOffset: DEFAULT_MAX_OFFSET,
    autoFillTargetSize: 10,
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
        ...parsed,
        maxOffset: parsed.maxOffset ?? defaultState.maxOffset
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
  setAllowExplicit: (allowExplicit: boolean) => void
  setMaxSongLength: (maxSongLength: number) => void
  setSongsBetweenRepeats: (songsBetweenRepeats: number) => void
  setMaxOffset: (maxOffset: number) => void
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

  const setAllowExplicit = useCallback(
    (allowExplicit: boolean): void => {
      updateState({ allowExplicit })
    },
    [updateState]
  )

  const setMaxSongLength = useCallback(
    (maxSongLength: number): void => {
      updateState({ maxSongLength })
    },
    [updateState]
  )

  const setSongsBetweenRepeats = useCallback(
    (songsBetweenRepeats: number): void => {
      updateState({ songsBetweenRepeats })
    },
    [updateState]
  )

  const setMaxOffset = useCallback(
    (maxOffset: number): void => {
      updateState({ maxOffset })
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
    setAllowExplicit,
    setMaxSongLength,
    setSongsBetweenRepeats,
    setMaxOffset,
    setAutoFillTargetSize
  }
}
