import { useState, useEffect, useRef } from 'react'
import { FALLBACK_GENRES, type Genre } from '@/shared/constants/trackSuggestion'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const STORAGE_KEY = 'track-suggestions-state'

const getInitialState = (): TrackSuggestionsState => {
  if (typeof window === 'undefined') {
    return {
      genres: [...FALLBACK_GENRES.slice(0, 10)],
      yearRange: [1950, new Date().getFullYear()],
      popularity: 50,
      allowExplicit: false,
      maxSongLength: 3,
      songsBetweenRepeats: 5,
      maxOffset: 1000
    }
  }

  const savedState = localStorage.getItem(STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as TrackSuggestionsState
      return {
        ...parsed,
        genres:
          parsed.genres?.length > 0
            ? parsed.genres.slice(0, 10)
            : [...FALLBACK_GENRES.slice(0, 10)],
        maxSongLength: Math.max(3, parsed.maxSongLength ?? 3),
        maxOffset: parsed.maxOffset ?? 1000
      }
    } catch (error) {
      console.error('[TrackSuggestions] Failed to parse localStorage:', error)
    }
  }

  return {
    genres: [...FALLBACK_GENRES.slice(0, 10)],
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 3,
    songsBetweenRepeats: 5,
    maxOffset: 1000
  }
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
}

export function useTrackSuggestions(): UseTrackSuggestionsReturn {
  const [state, setState] = useState<TrackSuggestionsState>(getInitialState)
  const stateRef = useRef(state)

  // Update ref when state changes
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Persist state changes to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const updateState = (newState: Partial<TrackSuggestionsState>): void => {
    setState((prev) => ({ ...prev, ...newState }))
  }

  return {
    state,
    updateState,
    setGenres: (genres: Genre[]): void => updateState({ genres }),
    setYearRange: (yearRange: [number, number]): void =>
      updateState({ yearRange }),
    setPopularity: (popularity: number): void => updateState({ popularity }),
    setAllowExplicit: (allowExplicit: boolean): void =>
      updateState({ allowExplicit }),
    setMaxSongLength: (maxSongLength: number): void =>
      updateState({ maxSongLength }),
    setSongsBetweenRepeats: (songsBetweenRepeats: number): void =>
      updateState({ songsBetweenRepeats }),
    setMaxOffset: (maxOffset: number): void => updateState({ maxOffset })
  }
}
