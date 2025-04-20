'use client'

import { RefreshCw } from 'lucide-react'

interface YearRangeSelectorProps {
  range: [number, number]
  onRangeChange: (range: [number, number]) => void
}

export function YearRangeSelector({
  range,
  onRangeChange
}: YearRangeSelectorProps): JSX.Element {
  const currentYear = new Date().getFullYear()
  const defaultRange: [number, number] = [currentYear - 30, currentYear]
  const minYear = 1900

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value
    onRangeChange([Number(value), range[1]])
  }

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value
    onRangeChange([range[0], Number(value)])
  }

  const handleReset = (): void => {
    onRangeChange(defaultRange)
  }

  const getError = (): string | null => {
    if (range[0] < minYear) {
      return `From year must be at least ${minYear}`
    }
    if (range[1] > currentYear) {
      return `To year cannot be greater than ${currentYear}`
    }
    if (range[0] > range[1]) {
      return 'From year cannot be greater than To year'
    }
    return null
  }

  const error = getError()

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-medium'>Year Range</h3>
        <button
          onClick={handleReset}
          className='flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
        >
          <RefreshCw className='h-3 w-3' />
          Reset
        </button>
      </div>

      <div className='flex items-center gap-4'>
        <div className='flex-1'>
          <label
            htmlFor='min-year'
            className='block text-sm text-muted-foreground'
          >
            From
          </label>
          <input
            id='min-year'
            type='text'
            value={range[0]}
            onChange={handleMinChange}
            className='mt-1 block w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          />
        </div>
        <div className='flex-1'>
          <label
            htmlFor='max-year'
            className='block text-sm text-muted-foreground'
          >
            To
          </label>
          <input
            id='max-year'
            type='text'
            value={range[1]}
            onChange={handleMaxChange}
            className='mt-1 block w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          />
        </div>
      </div>

      {error && (
        <div className='rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive'>
          {error}
        </div>
      )}

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          Selected range: {range[0]} - {range[1]} ({range[1] - range[0] + 1}{' '}
          years)
        </p>
      </div>
    </div>
  )
}
