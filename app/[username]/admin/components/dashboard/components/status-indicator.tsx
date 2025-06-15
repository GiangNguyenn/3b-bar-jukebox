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
    <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
      <h3 className='mb-2 text-sm font-medium text-gray-400'>{title}</h3>
      <div className='flex items-center space-x-2'>
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            colorMap[status] ?? 'bg-gray-500'
          )}
        />
        <span className='text-sm text-gray-300'>
          {label}
          {subtitle && <span className='ml-2 text-gray-400'>{subtitle}</span>}
        </span>
      </div>
    </div>
  )
} 