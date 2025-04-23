'use client'

import { useEffect, useRef, useState } from 'react'
import { FALLBACK_GENRES, type Genre } from '@/shared/constants/trackSuggestion'
import { GenresSelector } from './components/genres-selector'
import { YearRangeSelector } from './components/year-range-selector'
import { PopularitySelector } from './components/popularity-selector'
import { ExplicitContentToggle } from './components/explicit-content-toggle'
import { MaxSongLengthSelector } from './components/max-song-length-selector'
import { SongsBetweenRepeatsSelector } from './components/songs-between-repeats-selector'
import { LastSuggestedTrack } from './components/last-suggested-track'
import { type TrackSuggestionsState, type LastSuggestedTrackInfo } from '@/shared/types/trackSuggestions'

interface TrackSuggestionsTabProps {
  onStateChange: (state: TrackSuggestionsState) => void
}

interface LastSuggestedTrackResponse {
  track: LastSuggestedTrackInfo | null
}

const STORAGE_KEY = 'track-suggestions-state'
const POLL_INTERVAL = 1000 // Reduced to 1 second

const getInitialState = (): TrackSuggestionsState => {
  if (typeof window === 'undefined') {
    console.log(
      '[PARAM CHAIN] Server-side initialization in getInitialState (track-suggestions-tab.tsx)'
    )
    return {
      genres: [...FALLBACK_GENRES.slice(0, 10)],
      yearRange: [1950, new Date().getFullYear()],
      popularity: 50,
      allowExplicit: false,
      maxSongLength: 3,
      songsBetweenRepeats: 5
    }
  }

  const savedState = localStorage.getItem(STORAGE_KEY)
  console.log(
    '[PARAM CHAIN] Raw localStorage value in getInitialState (track-suggestions-tab.tsx):',
    savedState
  )

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as TrackSuggestionsState
      // Ensure genres array is not empty and has max 10 items
      const validGenres =
        parsed.genres?.length > 0
          ? parsed.genres.slice(0, 10)
          : [...FALLBACK_GENRES.slice(0, 10)]

      return {
        ...parsed,
        genres: validGenres,
        maxSongLength: Math.max(3, parsed.maxSongLength ?? 3)
      }
    } catch (error) {
      console.error(
        '[PARAM CHAIN] Failed to parse localStorage in getInitialState (track-suggestions-tab.tsx):',
        error
      )
      // If parsing fails, return default state
    }
  }

  console.log(
    '[PARAM CHAIN] Using default genres in getInitialState (track-suggestions-tab.tsx)'
  )
  return {
    genres: [...FALLBACK_GENRES.slice(0, 10)],
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 3,
    songsBetweenRepeats: 5
  }
}

export function TrackSuggestionsTab({
  onStateChange
}: TrackSuggestionsTabProps): JSX.Element {
  const [state, setState] = useState<TrackSuggestionsState>(getInitialState)
  const lastTrackUriRef = useRef<string | null>(null)
  const pollTimeoutRef = useRef<NodeJS.Timeout>()
  const isInitialMount = useRef(true)
  const stateRef = useRef(state)

  // Update ref when state changes
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Persist state changes to localStorage
  useEffect(() => {
    console.log('[PARAM CHAIN] State changed, saving to localStorage:', state)
    console.log('[PARAM CHAIN] Genres being saved:', state.genres)
    console.log(
      '[PARAM CHAIN] Number of genres being saved:',
      state.genres.length
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // Call onStateChange after initial mount
  useEffect(() => {
    if (!isInitialMount.current) {
      onStateChange(stateRef.current)
    }
    isInitialMount.current = false
  }, [onStateChange])

  const fetchLastSuggestedTrack = async (): Promise<void> => {
    try {
      const response = await fetch('/api/track-suggestions/last-suggested')
      if (!response.ok) throw new Error('Failed to fetch last suggested track')

      const data = (await response.json()) as LastSuggestedTrackResponse

      if (data.track) {
        // Only update if the track has changed
        if (data.track.uri !== lastTrackUriRef.current) {
          console.log('[TrackSuggestions] New track detected:', data.track)
          setState((prev) => ({
            ...prev,
            lastSuggestedTrack: data.track ?? undefined
          }))
          lastTrackUriRef.current = data.track.uri
        }
      }
    } catch (error) {
      console.error(
        '[TrackSuggestions] Error fetching last suggested track:',
        error
      )
    }
  }

  useEffect(() => {
    // Initial fetch
    void fetchLastSuggestedTrack()

    // Set up polling
    const poll = (): void => {
      void fetchLastSuggestedTrack()
      pollTimeoutRef.current = setTimeout(poll, POLL_INTERVAL)
    }
    poll()

    return (): void => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
      }
    }
  }, [])

  const handleGenresChange = (genres: Genre[]): void => {
    setState((prev) => ({ ...prev, genres }))
  }

  const handleYearRangeChange = (range: [number, number]): void => {
    setState((prev) => ({ ...prev, yearRange: range }))
  }

  const handlePopularityChange = (popularity: number): void => {
    setState((prev) => ({ ...prev, popularity }))
  }

  const handleExplicitChange = (allowExplicit: boolean): void => {
    setState((prev) => ({ ...prev, allowExplicit }))
  }

  const handleMaxSongLengthChange = (maxSongLength: number): void => {
    setState((prev) => ({ ...prev, maxSongLength }))
  }

  const handleSongsBetweenRepeatsChange = (
    songsBetweenRepeats: number
  ): void => {
    setState((prev) => ({ ...prev, songsBetweenRepeats }))
  }

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
            onGenresChange={handleGenresChange}
          />
          <YearRangeSelector
            range={state.yearRange}
            onRangeChange={handleYearRangeChange}
          />
          <PopularitySelector
            popularity={state.popularity}
            onPopularityChange={handlePopularityChange}
          />
        </div>
        <div className='space-y-6'>
          <ExplicitContentToggle
            isAllowed={state.allowExplicit}
            onToggleChange={handleExplicitChange}
          />
          <MaxSongLengthSelector
            length={state.maxSongLength}
            onLengthChange={handleMaxSongLengthChange}
          />
          <SongsBetweenRepeatsSelector
            count={state.songsBetweenRepeats}
            onCountChange={handleSongsBetweenRepeatsChange}
          />
        </div>
      </div>
    </div>
  )
}
