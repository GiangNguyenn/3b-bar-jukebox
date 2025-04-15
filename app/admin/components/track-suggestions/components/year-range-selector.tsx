'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

interface YearRangeSelectorProps {
  onRangeChange?: (range: [number, number]) => void
}

export function YearRangeSelector({
  onRangeChange
}: YearRangeSelectorProps): JSX.Element {
  const currentYear = new Date().getFullYear()
  const defaultRange: [number, number] = [currentYear - 30, currentYear]
  const [range, setRange] = useState<[number, number]>(defaultRange)

  useEffect(() => {
    onRangeChange?.(range)
  }, [range, onRangeChange])

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const min = Math.min(Number(e.target.value), range[1] - 1)
    setRange([min, range[1]])
  }

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const max = Math.max(Number(e.target.value), range[0] + 1)
    setRange([range[0], max])
  }

  const handleReset = (): void => {
    setRange(defaultRange)
  }

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

      <div className='space-y-2'>
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
              type='number'
              min={1900}
              max={range[1] - 1}
              value={range[0]}
              onChange={handleMinChange}
              className='mt-1 block w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
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
              type='number'
              min={range[0] + 1}
              max={currentYear}
              value={range[1]}
              onChange={handleMaxChange}
              className='mt-1 block w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            />
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          Selected range: {range[0]} - {range[1]} ({range[1] - range[0] + 1}{' '}
          years)
        </p>
      </div>
    </div>
  )
}
