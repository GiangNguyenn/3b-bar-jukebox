'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { GenresSelector } from './components/genres-selector'
import { YearRangeSelector } from './components/year-range-selector'
import { PopularitySelector } from './components/popularity-selector'
import { ExplicitContentToggle } from './components/explicit-content-toggle'
import { MaxSongLengthSelector } from './components/max-song-length-selector'
import { SongsBetweenRepeatsSelector } from './components/songs-between-repeats-selector'
import { MaxOffsetSelector } from './components/max-offset-selector'
import { AutoFillTargetSelector } from './components/auto-fill-target-selector'
import { LastSuggestedTrack } from './components/last-suggested-track'
import {
  type TrackSuggestionsState,
  type LastSuggestedTrackInfo
} from '@/shared/types/trackSuggestions'
import { useTrackSuggestions } from './hooks/useTrackSuggestions'
import { type Genre } from '@/shared/constants/trackSuggestion'

interface TrackSuggestionsTabProps {
  onStateChange: (state: TrackSuggestionsState) => void
  initialState?: Partial<TrackSuggestionsState>
}

interface LastSuggestedTrackResponse {
  track: LastSuggestedTrackInfo | null
}

const POLL_INTERVAL = 30000 // 30 seconds
const DEBOUNCE_MS = 1000 // 1 second

export function TrackSuggestionsTab({
  onStateChange,
  initialState
}: TrackSuggestionsTabProps): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const {
    state,
    setGenres,
    setYearRange,
    setPopularity,
    setAllowExplicit,
    setMaxSongLength,
    setSongsBetweenRepeats,
    setMaxOffset,
    setAutoFillTargetSize,
    updateState
  } = useTrackSuggestions(initialState)

  const currentYear = new Date().getFullYear()

  function applyPreset(preset: 'party' | 'chill' | 'rock' | 'classics'): void {
    if (preset === 'party') {
      const genres: Genre[] = ['Pop', 'Dance Pop', 'Viral Pop']
      updateState({
        genres,
        popularity: 80,
        yearRange: [currentYear - 1, currentYear]
      })
      return
    }

    if (preset === 'chill') {
      const genres: Genre[] = [
        'Chill-out',
        'Chill Lounge',
        'Chill Groove',
        'Ambient',
        'Lounge',
        'Smooth Jazz',
        'Soft Rock'
      ]
      updateState({
        genres,
        popularity: 60,
        yearRange: [currentYear - 9, currentYear]
      })
      return
    }

    if (preset === 'rock') {
      const genres: Genre[] = [
        'Rock',
        'Metal',
        'Alternative Rock',
        'Alternative Metal',
        'Hard Rock',
        'Indie Rock'
      ]
      updateState({
        genres,
        popularity: 60,
        yearRange: [currentYear - 19, currentYear]
      })
      return
    }

    // classics
    const genres: Genre[] = [
      'Classic Rock',
      'Pop',
      'Disco',
      'Funk',
      'Soul',
      'R&b'
    ]
    updateState({
      genres,
      popularity: 75,
      yearRange: [1960, 2009]
    })
  }

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
      addLog(
        'LOG',
        'Fetching last suggested track with updated URL...',
        'TrackSuggestionsTab'
      )
      const response = await fetch('/api/track-suggestions?latest=true')
      if (!response.ok) {
        throw new Error('Failed to fetch last suggested track')
      }
      const data = (await response.json()) as LastSuggestedTrackResponse

      if (data.track?.uri !== lastTrackUriRef.current) {
        updateState({ lastSuggestedTrack: data.track ?? undefined })
        lastTrackUriRef.current = data.track?.uri ?? null
      }
    } catch (error) {
      addLog(
        'ERROR',
        'Error fetching last suggested track',
        'TrackSuggestionsTab',
        error as Error
      )
    }
  }, [updateState, addLog])

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
        <h2 className='text-2xl font-bold'>Suggestions</h2>
      </div>

      <div className='space-y-3'>
        <div className='text-sm text-muted-foreground'>Quick presets</div>
        <div className='grid gap-3 md:grid-cols-2'>
          <button
            type='button'
            onClick={() => applyPreset('party')}
            className='border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10 group w-full cursor-pointer rounded-lg border-2 px-4 py-3 text-left text-sm transition-all duration-200 hover:shadow-md'
            aria-label='Apply Party Mode preset'
          >
            <div className='text-primary group-hover:text-primary/80 font-semibold'>
              Party Mode
            </div>
            <div className='text-xs text-muted-foreground group-hover:text-muted-foreground/80'>
              Latest Pop Hits
            </div>
          </button>
          <button
            type='button'
            onClick={() => applyPreset('chill')}
            className='border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10 group w-full cursor-pointer rounded-lg border-2 px-4 py-3 text-left text-sm transition-all duration-200 hover:shadow-md'
            aria-label='Apply Chill Mode preset'
          >
            <div className='text-primary group-hover:text-primary/80 font-semibold'>
              Chill Mode
            </div>
            <div className='group-hover:text-primary/80 text-xs text-muted-foreground'>
              Easy Listening
            </div>
          </button>
          <button
            type='button'
            onClick={() => applyPreset('rock')}
            className='border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10 group w-full cursor-pointer rounded-lg border-2 px-4 py-3 text-left text-sm transition-all duration-200 hover:shadow-md'
            aria-label="Apply Let's Rock preset"
          >
            <div className='text-primary group-hover:text-primary/80 font-semibold'>
              Let&apos;s Rock
            </div>
            <div className='group-hover:text-primary/80 text-xs text-muted-foreground'>
              Latest Rock and Metal
            </div>
          </button>
          <button
            type='button'
            onClick={() => applyPreset('classics')}
            className='border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10 group w-full cursor-pointer rounded-lg border-2 px-4 py-3 text-left text-sm transition-all duration-200 hover:shadow-md'
            aria-label='Apply Classics preset'
          >
            <div className='text-primary group-hover:text-primary/80 font-semibold'>
              Classics
            </div>
            <div className='group-hover:text-primary/80 text-xs text-muted-foreground'>
              Classic Hits from the Ages
            </div>
          </button>
        </div>
      </div>

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
          <AutoFillTargetSelector
            targetSize={state.autoFillTargetSize}
            onTargetSizeChange={setAutoFillTargetSize}
          />
        </div>
      </div>

      {/* Advanced Section */}
      <div className='rounded-lg border'>
        <button
          type='button'
          onClick={(): void => setIsAdvancedOpen(!isAdvancedOpen)}
          className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50'
        >
          <span className='text-lg font-medium'>Advanced</span>
          <svg
            className={`h-5 w-5 text-gray-500 transition-transform ${
              isAdvancedOpen ? 'rotate-180' : ''
            }`}
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M19 9l-7 7-7-7'
            />
          </svg>
        </button>
        {isAdvancedOpen && (
          <div className='space-y-6 px-4 pb-4'>
            <div className='grid gap-6 md:grid-cols-2'>
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
        )}
      </div>

      <LastSuggestedTrack trackInfo={state.lastSuggestedTrack} />

      {/* Description Section */}
      <div className='rounded-lg border bg-muted p-4'>
        <h3 className='mb-2 text-lg font-medium'>How Suggestions Work</h3>
        <p className='text-sm text-muted-foreground'>
          When the playlist queue has fewer than {state.autoFillTargetSize}{' '}
          tracks, the system will automatically add tracks based on your
          suggestion preferences above to maintain a minimum of{' '}
          {state.autoFillTargetSize} tracks. If it fails to find a song that
          matches your criteria, it will automatically add a random track to
          keep the music playing.
          <br />
          <br />
          Songs added by users to the jukebox will always take priority over
          suggested songs.
        </p>
      </div>
    </div>
  )
}
