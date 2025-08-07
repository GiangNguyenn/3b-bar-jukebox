'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ExplicitContentToggleProps {
  isAllowed: boolean
  onToggleChange: (isAllowed: boolean) => void
}

export function ExplicitContentToggle({
  isAllowed,
  onToggleChange
}: ExplicitContentToggleProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>Explicit Content</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <label className='flex items-center space-x-2'>
          <input
            type='checkbox'
            checked={isAllowed}
            onChange={(e) => onToggleChange(e.target.checked)}
            className='rounded border-input bg-background text-foreground focus:ring-2 focus:ring-ring'
          />
          <span className='text-sm text-muted-foreground'>
            Allow explicit content
          </span>
        </label>
      </CardContent>
    </Card>
  )
}
