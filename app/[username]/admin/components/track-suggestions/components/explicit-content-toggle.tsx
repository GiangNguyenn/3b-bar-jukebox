'use client'

interface ExplicitContentToggleProps {
  isAllowed: boolean
  onToggleChange: (isAllowed: boolean) => void
}

export function ExplicitContentToggle({
  isAllowed,
  onToggleChange
}: ExplicitContentToggleProps): JSX.Element {
  return (
    <div className='space-y-2'>
      <h3 className='text-lg font-medium'>Explicit Content</h3>
      <label className='flex items-center space-x-2'>
        <input
          type='checkbox'
          checked={isAllowed}
          onChange={(e) => onToggleChange(e.target.checked)}
          className='rounded border-input bg-background text-foreground focus:ring-2 focus:ring-ring'
        />
        <span className='text-sm text-muted-foreground'>Allow explicit content</span>
      </label>
    </div>
  )
} 