'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

interface ErrorMessageProps {
  message: string
  onDismiss?: () => void
  autoDismissMs?: number
  className?: string
  variant?: 'error' | 'offline' | 'recovering'
}

export function ErrorMessage({
  message,
  onDismiss,
  autoDismissMs = 5000, // 5 seconds default
  className = '',
  variant = 'error'
}: ErrorMessageProps): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(true)

  useEffect((): (() => void) | undefined => {
    if (autoDismissMs > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false)
        onDismiss?.()
      }, autoDismissMs)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [autoDismissMs, onDismiss])

  const handleDismiss = (): void => {
    setIsVisible(false)
    onDismiss?.()
  }

  if (!isVisible) {
    return null
  }

  const getVariantStyles = (): string => {
    switch (variant) {
      case 'offline':
        return 'border-orange-500 bg-orange-900/50 text-orange-100'
      case 'recovering':
        return 'border-blue-500 bg-blue-900/50 text-blue-100'
      default:
        return 'border-red-500 bg-red-900/50 text-red-100'
    }
  }

  return (
    <div className={`relative rounded p-4 ${getVariantStyles()} ${className}`}>
      <button
        onClick={handleDismiss}
        className='absolute right-2 top-2 text-red-300 transition-colors hover:text-red-100'
        aria-label='Dismiss error'
      >
        <X size={16} />
      </button>
      <div className='pr-8'>{message}</div>
    </div>
  )
}
