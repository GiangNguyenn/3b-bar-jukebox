'use client'

import { RefreshCw } from 'lucide-react'

interface MaxSongLengthSelectorProps {
  length: number
  onLengthChange: (minutes: number) => void
}

export function MaxSongLengthSelector({
  length,
  onLengthChange
}: MaxSongLengthSelectorProps): JSX.Element {
  const defaultLength = 10

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onLengthChange(Number(e.target.value))
  }

  const handleReset = (): void => {
    onLengthChange(defaultLength)
  }

  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`
    }
    return `${remainingMinutes}m`
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-medium'>Maximum Song Length</h3>
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
              htmlFor='max-length'
              className='block text-sm text-muted-foreground'
            >
              Maximum Length: {formatTime(length)}
            </label>
            <input
              id='max-length'
              type='range'
              min={3}
              max={20}
              value={length}
              onChange={handleChange}
              className='accent-primary mt-1 block w-full'
            />
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>3m</span>
              <span>10m</span>
              <span>20m</span>
            </div>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          Songs longer than {formatTime(length)} will be filtered from
          suggestions
        </p>
      </div>
    </div>
  )
}
