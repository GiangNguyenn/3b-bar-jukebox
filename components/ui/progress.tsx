import React from 'react'

interface ProgressProps {
  value: number
  className?: string
}

export function Progress({ value, className = '' }: ProgressProps): JSX.Element {
  return (
    <div className={`w-full rounded bg-gray-700 ${className}`}>
      <div
        className='h-2 rounded bg-blue-500 transition-all duration-300'
        style={{ width: `${value}%` }}
      />
    </div>
  )
}
