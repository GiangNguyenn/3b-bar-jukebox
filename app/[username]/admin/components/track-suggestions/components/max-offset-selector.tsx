'use client'

import { RefreshCw } from 'lucide-react'
import { DEFAULT_MAX_OFFSET } from '@/shared/constants/trackSuggestion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MaxOffsetSelectorProps {
  offset: number
  onOffsetChange: (offset: number) => void
}

export function MaxOffsetSelector({
  offset,
  onOffsetChange
}: MaxOffsetSelectorProps): JSX.Element {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onOffsetChange(Number(e.target.value))
  }

  const handleReset = (): void => {
    onOffsetChange(DEFAULT_MAX_OFFSET)
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <CardTitle className='text-lg'>Max Offset</CardTitle>
            <span className='inline-flex items-center rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800'>
              Experimental
            </span>
          </div>
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
                htmlFor='max-offset'
                className='block text-sm text-muted-foreground'
              >
                Maximum Offset: {offset}
              </label>
              <input
                id='max-offset'
                type='range'
                min={1}
                max={100}
                value={offset}
                onChange={handleChange}
                className='accent-primary mt-1 block w-full'
              />
              <div className='flex justify-between text-xs text-muted-foreground'>
                <span>1</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>
          </div>
        </div>

        <div className='rounded-lg border bg-muted p-3 text-sm'>
          <p className='text-muted-foreground'>
            Spotify search results are paginated. This setting controls the
            maximum page offset (1 to {offset}) from which to randomly select
            results. Increasing this value may increase song diversity but could
            result in no songs being found if the offset exceeds available
            results.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
