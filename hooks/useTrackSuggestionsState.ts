import { useEffect, useState } from 'react'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const STORAGE_KEY = 'track-suggestions-state'

const getInitialState = (): TrackSuggestionsState => {
  if (typeof window === 'undefined') {
    return {
      genres: [],
      yearRange: [1950, new Date().getFullYear()],
      popularity: 50,
      allowExplicit: false,
      maxSongLength: 3,
      songsBetweenRepeats: 5
    }
  }

  const savedState = localStorage.getItem(STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as TrackSuggestionsState
      return {
        ...parsed,
        maxSongLength: Math.max(3, parsed.maxSongLength ?? 3)
      }
    } catch (error) {
      console.error(
        '[TrackSuggestionsState] Failed to parse localStorage:',
        error
      )
    }
  }

  return {
    genres: [],
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 3,
    songsBetweenRepeats: 5
  }
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
