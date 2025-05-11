import React from 'react'

interface ProgressProps {
  value: number
  className?: string
}

export function Progress({ value, className = '' }: ProgressProps) {
  return (
    <div className={`w-full bg-gray-700 rounded ${className}`}>
      <div
        className="bg-blue-500 h-2 rounded transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  )
} 