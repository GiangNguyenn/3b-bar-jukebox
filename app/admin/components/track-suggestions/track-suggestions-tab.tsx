'use client'

import { useEffect, useRef, useCallback } from 'react'
import { GenresSelector } from './components/genres-selector'
import { YearRangeSelector } from './components/year-range-selector'
import { PopularitySelector } from './components/popularity-selector'
import { ExplicitContentToggle } from './components/explicit-content-toggle'
import { MaxSongLengthSelector } from './components/max-song-length-selector'
import { SongsBetweenRepeatsSelector } from './components/songs-between-repeats-selector'
import { MaxOffsetSelector } from './components/max-offset-selector'
import { LastSuggestedTrack } from './components/last-suggested-track'
import {
  type TrackSuggestionsState,
  type LastSuggestedTrackInfo
} from '@/shared/types/trackSuggestions'
import { useTrackSuggestions } from './hooks/useTrackSuggestions'

interface TrackSuggestionsTabProps {
  onStateChange: (state: TrackSuggestionsState) => void
}

interface LastSuggestedTrackResponse {
  track: LastSuggestedTrackInfo | null
}

const POLL_INTERVAL = 30000 // 30 seconds
const DEBOUNCE_MS = 1000 // 1 second

export function TrackSuggestionsTab({
  onStateChange
}: TrackSuggestionsTabProps): JSX.Element {
  const {
    state,
    setGenres,
    setYearRange,
    setPopularity,
    setAllowExplicit,
    setMaxSongLength,
    setSongsBetweenRepeats,
    setMaxOffset,
    updateState
  } = useTrackSuggestions()

  const lastTrackUriRef = useRef<string | null>(null)
  const isInitialMount = useRef(true)
  const lastFetchTimeRef = useRef<number>(0)
  const prevStateRef = useRef(state)

  // Call onStateChange only when state actually changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      prevStateRef.current = state
      return
    }

    // Only call onStateChange if state has actually changed
    if (JSON.stringify(prevStateRef.current) !== JSON.stringify(state)) {
      onStateChange(state)
      prevStateRef.current = state
    }
  }, [state, onStateChange])

  const fetchLastSuggestedTrack = useCallback(async (): Promise<void> => {
    const now = Date.now()
    if (now - lastFetchTimeRef.current < DEBOUNCE_MS) {
      return
    }
    lastFetchTimeRef.current = now

    try {
      const response = await fetch('/api/track-suggestions/last-suggested')
      if (!response.ok) {
        throw new Error('Failed to fetch last suggested track')
      }
      const data = (await response.json()) as LastSuggestedTrackResponse

      if (data.track?.uri !== lastTrackUriRef.current) {
        updateState({ lastSuggestedTrack: data.track ?? undefined })
        lastTrackUriRef.current = data.track?.uri ?? null
      }
    } catch (error) {
      console.error(
        '[TrackSuggestionsTab] Error fetching last suggested track:',
        error
      )
    }
  }, [updateState])

  useEffect(() => {
    // Initial fetch
    void fetchLastSuggestedTrack()

    // Set up polling with setInterval
    const intervalId = setInterval(() => {
      void fetchLastSuggestedTrack()
    }, POLL_INTERVAL)

    return (): void => {
      clearInterval(intervalId)
    }
  }, [fetchLastSuggestedTrack])

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Track Suggestions</h2>
      </div>

      <LastSuggestedTrack trackInfo={state.lastSuggestedTrack} />

      <div className='grid gap-6 md:grid-cols-2'>
        <div className='space-y-6'>
          <GenresSelector
            selectedGenres={state.genres}
            onGenresChange={setGenres}
          />
          <YearRangeSelector
            range={state.yearRange}
            onRangeChange={setYearRange}
          />
          <PopularitySelector
            popularity={state.popularity}
            onPopularityChange={setPopularity}
          />
        </div>
        <div className='space-y-6'>
          <ExplicitContentToggle
            isAllowed={state.allowExplicit}
            onToggleChange={setAllowExplicit}
          />
          <MaxSongLengthSelector
            length={state.maxSongLength}
            onLengthChange={setMaxSongLength}
          />
          <SongsBetweenRepeatsSelector
            count={state.songsBetweenRepeats}
            onCountChange={setSongsBetweenRepeats}
          />
          <MaxOffsetSelector
            offset={state.maxOffset}
            onOffsetChange={setMaxOffset}
          />
        </div>
      </div>
    </div>
  )
}
