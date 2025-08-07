import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AutoFillTargetSelectorProps {
  targetSize: number
  onTargetSizeChange: (targetSize: number) => void
}

export function AutoFillTargetSelector({
  targetSize,
  onTargetSizeChange
}: AutoFillTargetSelectorProps): JSX.Element {
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onTargetSizeChange(parseInt(e.target.value, 10))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>Auto-Fill Target Size</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-2'>
          <label
            htmlFor='auto-fill-target'
            className='block text-sm text-muted-foreground'
          >
            Minimum tracks in queue ({targetSize})
          </label>
          <div className='flex-1'>
            <input
              id='auto-fill-target'
              type='range'
              min={3}
              max={100}
              value={targetSize}
              onChange={handleRangeChange}
              className='accent-primary mt-1 block w-full'
            />
            <div className='flex justify-between text-xs text-muted-foreground'>
              <span>3</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>
          <p className='text-sm text-muted-foreground'>
            The system will automatically add tracks to maintain at least this
            many tracks in your playlist queue.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
