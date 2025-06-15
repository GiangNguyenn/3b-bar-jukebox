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

      <div className='flex items-center space-x-4'>
        <input
          type='text'
          inputMode='numeric'
          pattern='[0-9]*'
          value={range[0]}
          onChange={(e) => {
            const value = e.target.value
            if (value === '' || /^\d+$/.test(value)) {
              onRangeChange([parseInt(value) || 0, range[1]])
            }
          }}
          className='w-24 rounded-lg border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
          placeholder='Start Year'
        />
        <span>to</span>
        <input
          type='text'
          inputMode='numeric'
          pattern='[0-9]*'
          value={range[1]}
          onChange={(e) => {
            const value = e.target.value
            if (value === '' || /^\d+$/.test(value)) {
              onRangeChange([range[0], parseInt(value) || 0])
            }
          }}
          className='w-24 rounded-lg border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
          placeholder='End Year'
        />
      </div>

      {error && (
        <div className='rounded-lg border border-red-500 bg-red-500/10 p-3 text-sm font-medium text-red-500'>
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