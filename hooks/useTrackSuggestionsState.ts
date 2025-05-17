import { useEffect, useState } from 'react'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const STORAGE_KEY = 'track-suggestions-state'

const getInitialState = (): TrackSuggestionsState => {
  const defaultState: TrackSuggestionsState = {
    genres: [],
    yearRange: [1950, new Date().getFullYear()] as [number, number],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 3,
    songsBetweenRepeats: 5,
    maxOffset: 1000
  }

  if (typeof window === 'undefined') {
    return defaultState
  }

  const savedState = localStorage.getItem(STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as TrackSuggestionsState
      return {
        ...parsed,
        maxSongLength: Math.max(3, parsed.maxSongLength ?? 3),
        maxOffset: parsed.maxOffset ?? 1000
      }
    } catch (error) {
      console.error(
        '[TrackSuggestionsState] Failed to parse localStorage:',
        error
      )
    }
  }

  return defaultState
}

export function useTrackSuggestionsState() {
  const [state, setState] = useState<TrackSuggestionsState>(getInitialState)

  // Listen for changes in localStorage
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const newState = JSON.parse(e.newValue) as TrackSuggestionsState
          setState(newState)
        } catch (error) {
          console.error(
            '[TrackSuggestionsState] Failed to parse localStorage:',
            error
          )
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  return state
}
