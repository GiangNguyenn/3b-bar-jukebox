import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { useState, useCallback } from 'react'

const initialState: TrackSuggestionsState = {
  genres: [],
  yearRange: [1950, new Date().getFullYear()],
  popularity: 50,
  allowExplicit: false,
  maxSongLength: 3,
  songsBetweenRepeats: 5,
  maxOffset: 1000
}

interface TrackSuggestionsStateHook {
  state: TrackSuggestionsState
  updateState: (newState: Partial<TrackSuggestionsState>) => void
}

export function useTrackSuggestionsState(): TrackSuggestionsStateHook {
  const [state, setState] = useState<TrackSuggestionsState>(initialState)

  const updateState = useCallback(
    (newState: Partial<TrackSuggestionsState>): void => {
      setState((prevState) => ({
        ...prevState,
        ...newState
      }))
    },
    []
  )

  return {
    state,
    updateState
  }
}
