'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

interface ErrorMessageProps {
  message: string
  onDismiss?: () => void
  autoDismissMs?: number
  className?: string
}

export function ErrorMessage({
  message,
  onDismiss,
  autoDismissMs = 5000, // 5 seconds default
  className = ''
}: ErrorMessageProps): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (autoDismissMs > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false)
        onDismiss?.()
      }, autoDismissMs)

      return () => clearTimeout(timer)
    }
  }, [autoDismissMs, onDismiss])

  const handleDismiss = (): void => {
    setIsVisible(false)
    onDismiss?.()
  }

  if (!isVisible) {
    return null
  }

  return (
    <div
      className={`relative rounded border border-red-500 bg-red-900/50 p-4 text-red-100 ${className}`}
    >
      <button
        onClick={handleDismiss}
        className='absolute right-2 top-2 text-red-300 hover:text-red-100 transition-colors'
        aria-label='Dismiss error'
      >
        <X size={16} />
      </button>
      <div className='pr-8'>{message}</div>
    </div>
  )
} 