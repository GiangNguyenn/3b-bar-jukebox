'use client'

import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface PopularitySelectorProps {
  popularity: number
  onPopularityChange: (popularity: number) => void
}

export function PopularitySelector({
  popularity,
  onPopularityChange
}: PopularitySelectorProps): JSX.Element {
  const defaultPopularity = 50

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onPopularityChange(parseInt(e.target.value))
  }

  const handleReset = (): void => {
    onPopularityChange(defaultPopularity)
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-lg'>Minimum Popularity</CardTitle>
          <button
            onClick={handleReset}
            className='flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
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
                htmlFor='popularity'
                className='block text-sm text-muted-foreground'
              >
                Minimum Popularity: {popularity}
              </label>
              <input
                id='popularity'
                type='range'
                min={0}
                max={100}
                value={popularity}
                onChange={handleChange}
                className='accent-primary mt-1 block w-full'
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
            Selected minimum popularity: {popularity} (
            {popularity >= 75
              ? 'Very Popular'
              : popularity >= 50
                ? 'Popular'
                : popularity >= 25
                  ? 'Moderate'
                  : 'Less Popular'}
            )
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
