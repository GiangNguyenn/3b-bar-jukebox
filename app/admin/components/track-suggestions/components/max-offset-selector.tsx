'use client'

import { RefreshCw } from 'lucide-react'

interface MaxOffsetSelectorProps {
  offset: number
  onOffsetChange: (offset: number) => void
}

export function MaxOffsetSelector({
  offset,
  onOffsetChange
}: MaxOffsetSelectorProps): JSX.Element {
  const defaultOffset = 1000

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onOffsetChange(Number(e.target.value))
  }

  const handleReset = (): void => {
    onOffsetChange(defaultOffset)
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-medium'>Max Offset</h3>
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
              htmlFor='max-offset'
              className='block text-sm text-muted-foreground'
            >
              Maximum Offset: {offset}
            </label>
            <input
              id='max-offset'
              type='range'
              min={0}
              max={1000}
              value={offset}
              onChange={handleChange}
              className='accent-primary mt-1 block w-full'
            />
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>0</span>
              <span>500</span>
              <span>1000</span>
            </div>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          Maximum offset value for track suggestions: {offset}
        </p>
      </div>
    </div>
  )
}
