'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

interface PopularitySelectorProps {
  onPopularityChange?: (value: number) => void
}

export function PopularitySelector({ onPopularityChange }: PopularitySelectorProps): JSX.Element {
  const defaultPopularity = 50
  const [popularity, setPopularity] = useState<number>(defaultPopularity)

  useEffect(() => {
    onPopularityChange?.(popularity)
  }, [popularity, onPopularityChange])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setPopularity(Number(e.target.value))
  }

  const handleReset = (): void => {
    setPopularity(defaultPopularity)
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-medium'>Minimum Popularity</h3>
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
            <label htmlFor='popularity' className='block text-sm text-muted-foreground'>
              Minimum Popularity: {popularity}
            </label>
            <input
              id='popularity'
              type='range'
              min={0}
              max={100}
              value={popularity}
              onChange={handleChange}
              className='mt-1 block w-full accent-primary'
            />
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          Selected minimum popularity: {popularity} ({popularity >= 75 ? 'Very Popular' : popularity >= 50 ? 'Popular' : popularity >= 25 ? 'Moderate' : 'Less Popular'})
        </p>
      </div>
    </div>
  )
} 