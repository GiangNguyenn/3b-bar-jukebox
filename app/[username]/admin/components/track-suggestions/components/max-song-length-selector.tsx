'use client'

import { RefreshCw } from 'lucide-react'

interface MaxSongLengthSelectorProps {
  length: number
  onLengthChange: (length: number) => void
}

export function MaxSongLengthSelector({
  length,
  onLengthChange
}: MaxSongLengthSelectorProps): JSX.Element {
  const defaultLength = 10

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onLengthChange(parseInt(e.target.value))
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
        <input
          type='number'
          min='1'
          max='15'
          value={length}
          onChange={handleChange}
          className='w-24 rounded-lg border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
          placeholder='Length'
        />
        <p className='text-sm text-muted-foreground'>{length} minutes</p>
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
