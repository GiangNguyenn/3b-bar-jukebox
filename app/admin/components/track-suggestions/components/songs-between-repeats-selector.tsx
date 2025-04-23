'use client'

import { RefreshCw } from 'lucide-react'
import {
  SONGS_BETWEEN_REPEATS_DEFAULT,
  SONGS_BETWEEN_REPEATS_MAX,
  SONGS_BETWEEN_REPEATS_MIN
} from '../validations/trackSuggestions'

interface SongsBetweenRepeatsSelectorProps {
  count: number
  onCountChange: (count: number) => void
}

export function SongsBetweenRepeatsSelector({
  count,
  onCountChange
}: SongsBetweenRepeatsSelectorProps): JSX.Element {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onCountChange(Number(e.target.value))
  }

  const handleReset = (): void => {
    onCountChange(SONGS_BETWEEN_REPEATS_DEFAULT)
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-medium'>Songs Between Repeats</h3>
        <button
          onClick={handleReset}
          className='flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
        >
          <RefreshCw className='h-3 w-3' />
          Reset
        </button>
      </div>

      <div className='space-y-2'>
        <div className='flex items-center gap-4'>
          <div className='flex-1'>
            <label
              htmlFor='songs-between'
              className='block text-sm text-muted-foreground'
            >
              Minimum Songs Between Repeats: {count}
            </label>
            <input
              id='songs-between'
              type='range'
              min={SONGS_BETWEEN_REPEATS_MIN}
              max={SONGS_BETWEEN_REPEATS_MAX}
              value={count}
              onChange={handleChange}
              className='accent-primary mt-1 block w-full'
            />
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>{SONGS_BETWEEN_REPEATS_MIN}</span>
              <span>{SONGS_BETWEEN_REPEATS_DEFAULT}</span>
              <span>{SONGS_BETWEEN_REPEATS_MAX}</span>
            </div>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          A song will not be suggested again until at least {count} other songs
          have been played
        </p>
      </div>
    </div>
  )
}
