'use client'

import { formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface ErrorBoxProps {
  title: string
  message: string
  timestamp?: number
  children?: React.ReactNode
}

export function ErrorBox({
  title,
  message,
  timestamp,
  children
}: ErrorBoxProps): JSX.Element {
  return (
    <div className='rounded border border-red-500/50 bg-red-900/20 p-3'>
      <p className='text-sm font-medium text-red-200'>{title}</p>
      <p className='mt-1 text-sm text-red-100'>{message}</p>
      {timestamp && (
        <p className='mt-1 text-xs text-red-300/70'>
          {formatRelativeTime(timestamp)}
        </p>
      )}
      {children}
    </div>
  )
}

interface StatusFieldProps {
  label: string
  value: string | React.ReactNode
  className?: string
}

export function StatusField({
  label,
  value,
  className
}: StatusFieldProps): JSX.Element {
  return (
    <div className={className}>
      <p className='text-xs text-gray-400'>{label}</p>
      <p className='text-sm font-medium text-white'>{value}</p>
    </div>
  )
}

interface ChevronIconProps {
  expanded: boolean
  className?: string
}

export function ChevronIcon({
  expanded,
  className
}: ChevronIconProps): JSX.Element {
  return (
    <svg
      className={cn(
        'h-5 w-5 text-gray-400 transition-transform',
        expanded ? 'rotate-180' : '',
        className
      )}
      fill='none'
      stroke='currentColor'
      viewBox='0 0 24 24'
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M19 9l-7 7-7-7'
      />
    </svg>
  )
}

export function CopyIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      fill='none'
      stroke='currentColor'
      viewBox='0 0 24 24'
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
      />
    </svg>
  )
}

