'use client'

import { GenresSelector } from './components/genres-selector'
import { YearRangeSelector } from './components/year-range-selector'
import { PopularitySelector } from './components/popularity-selector'
import { ExplicitContentToggle } from './components/explicit-content-toggle'
import { MaxSongLengthSelector } from './components/max-song-length-selector'
import { SongsBetweenRepeatsSelector } from './components/songs-between-repeats-selector'

export function TrackSuggestionsTab(): JSX.Element {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Track Suggestions</h2>
      </div>

      <div className='grid gap-6 md:grid-cols-2'>
        <div className='space-y-6'>
          <GenresSelector />
          <YearRangeSelector />
          <PopularitySelector />
        </div>
        <div className='space-y-6'>
          <ExplicitContentToggle />
          <MaxSongLengthSelector />
          <SongsBetweenRepeatsSelector />
        </div>
      </div>
    </div>
  )
}
