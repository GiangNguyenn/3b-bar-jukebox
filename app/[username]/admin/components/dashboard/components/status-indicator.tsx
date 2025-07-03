'use client'

import { cn } from '@/lib/utils'

interface StatusIndicatorProps {
  title: string
  status: string
  colorMap: Record<string, string>
  label: string
  subtitle?: string
}

export function StatusIndicator({
  title,
  status,
  colorMap,
  label,
  subtitle
}: StatusIndicatorProps): JSX.Element {
  return (
    <div className='flex items-center justify-between py-1'>
      <div className='flex items-center space-x-2'>
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            colorMap[status] ?? 'bg-gray-500'
          )}
        />
        <span className='text-white text-sm font-semibold'>{title}</span>
      </div>
      <div className='flex items-center space-x-2'>
        <span className='text-white text-sm font-semibold'>{label}</span>
        {subtitle && (
          <span className='text-sm text-gray-400'>- {subtitle}</span>
        )}
      </div>
    </div>
  )
}
