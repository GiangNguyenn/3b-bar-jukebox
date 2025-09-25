'use client'

import { RefreshCw } from 'lucide-react'
import { SONGS_BETWEEN_REPEATS_DEFAULT } from '../validations/trackSuggestions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-lg'>Songs Between Repeats</CardTitle>
          <button
            onClick={handleReset}
            className='flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
          >
            <RefreshCw className='h-3 w-3' />
            Reset
          </button>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
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
                min={2}
                max={100}
                value={count}
                onChange={handleChange}
                className='accent-primary mt-1 block w-full'
              />
              <div className='flex justify-between text-xs text-muted-foreground'>
                <span>2</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>
          </div>
        </div>

        <div className='rounded-lg border bg-muted p-3 text-sm'>
          <p className='text-muted-foreground'>
            Prevents re-suggesting the same song until at least {count} other
            unique songs have been suggested. Increase to reduce repeats; lower
            values allow repeats sooner.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
