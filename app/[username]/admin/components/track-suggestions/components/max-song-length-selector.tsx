'use client'

import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-lg'>Maximum Song Length</CardTitle>
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
      </CardContent>
    </Card>
  )
}
