'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

interface SongsBetweenRepeatsSelectorProps {
  onCountChange?: (count: number) => void
}

export function SongsBetweenRepeatsSelector({ onCountChange }: SongsBetweenRepeatsSelectorProps): JSX.Element {
  const defaultCount = 20
  const [count, setCount] = useState<number>(defaultCount)

  useEffect(() => {
    onCountChange?.(count)
  }, [count, onCountChange])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setCount(Number(e.target.value))
  }

  const handleReset = (): void => {
    setCount(defaultCount)
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
            <label htmlFor='songs-between' className='block text-sm text-muted-foreground'>
              Minimum Songs Between Repeats: {count}
            </label>
            <input
              id='songs-between'
              type='range'
              min={2}
              max={100}
              value={count}
              onChange={handleChange}
              className='mt-1 block w-full accent-primary'
            />
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>2</span>
              <span>20</span>
              <span>100</span>
            </div>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          A song will not be suggested again until at least {count} other songs have been played
        </p>
      </div>
    </div>
  )
} 