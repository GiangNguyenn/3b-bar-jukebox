'use client'

import { useState, useEffect } from 'react'
import { X, CheckCircle } from 'lucide-react'

interface ToastProps {
  message: string
  onDismiss?: () => void
  autoDismissMs?: number
  className?: string
  variant?: 'success' | 'info' | 'warning'
}

export function Toast({
  message,
  onDismiss,
  autoDismissMs = 3000, // 3 seconds default for success messages
  className = '',
  variant = 'success'
}: ToastProps): JSX.Element | null {
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
      case 'info':
        return 'border-blue-500 bg-blue-900/50 text-blue-100'
      case 'warning':
        return 'border-yellow-500 bg-yellow-900/50 text-yellow-100'
      default:
        return 'border-green-500 bg-green-900/50 text-green-100'
    }
  }

  const getIcon = () => {
    switch (variant) {
      case 'success':
        return <CheckCircle className='h-4 w-4' />
      default:
        return null
    }
  }

  return (
    <div
      className={`fixed right-4 top-4 z-50 flex items-center space-x-3 rounded-lg border p-4 shadow-lg transition-all duration-300 ${getVariantStyles()} ${className}`}
    >
      {getIcon()}
      <span className='text-sm font-medium'>{message}</span>
      <button
        onClick={handleDismiss}
        className='text-green-300 transition-colors hover:text-green-100'
        aria-label='Dismiss toast'
      >
        <X size={16} />
      </button>
    </div>
  )
}
