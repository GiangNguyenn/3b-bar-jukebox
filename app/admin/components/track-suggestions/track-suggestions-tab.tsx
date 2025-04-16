'use client'

import { GenresSelector } from './components/genres-selector'
import { YearRangeSelector } from './components/year-range-selector'
import { PopularitySelector } from './components/popularity-selector'
import { ExplicitContentToggle } from './components/explicit-content-toggle'
import { MaxSongLengthSelector } from './components/max-song-length-selector'
import { SongsBetweenRepeatsSelector } from './components/songs-between-repeats-selector'

interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
}

interface TrackSuggestionsTabProps {
  state: TrackSuggestionsState
  onStateChange: (state: TrackSuggestionsState) => void
}

export function TrackSuggestionsTab({
  state,
  onStateChange
}: TrackSuggestionsTabProps): JSX.Element {
  const handleGenresChange = (genres: string[]): void => {
    onStateChange({ ...state, genres })
  }

  const handleYearRangeChange = (range: [number, number]): void => {
    onStateChange({ ...state, yearRange: range })
  }

  const handlePopularityChange = (popularity: number): void => {
    onStateChange({ ...state, popularity })
  }

  const handleExplicitChange = (allowExplicit: boolean): void => {
    onStateChange({ ...state, allowExplicit })
  }

  const handleMaxSongLengthChange = (maxSongLength: number): void => {
    onStateChange({ ...state, maxSongLength })
  }

  const handleSongsBetweenRepeatsChange = (
    songsBetweenRepeats: number
  ): void => {
    onStateChange({ ...state, songsBetweenRepeats })
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Track Suggestions</h2>
      </div>

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
