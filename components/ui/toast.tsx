'use client'

import { useEffect } from 'react'
import { X, CheckCircle } from 'lucide-react'

interface ToastProps {
  message: string
  onDismiss: () => void
  autoDismissMs?: number
  className?: string
  variant?: 'success' | 'info' | 'warning'
}

export function Toast({
  message,
  onDismiss,
  autoDismissMs = 3000,
  className = '',
  variant = 'success'
}: ToastProps): JSX.Element {
  useEffect(() => {
    if (autoDismissMs > 0) {
      const timer = setTimeout(onDismiss, autoDismissMs)
      return (): void => clearTimeout(timer)
    }
    return (): void => {}
  }, [autoDismissMs, onDismiss])

  const getVariantStyles = (): string => {
    switch (variant) {
      case 'info':
        return 'border-blue-500 bg-blue-900/50 text-blue-100'
      case 'warning':
        return 'border-yellow-500 bg-yellow-900/50 text-yellow-100'
      case 'success':
      default:
        return 'border-green-500 bg-green-900/50 text-green-100'
    }
  }

  const getIcon = (): JSX.Element | null => {
    switch (variant) {
      case 'success':
        return <CheckCircle className='h-4 w-4' />
      default:
        return null
    }
  }

  return (
    <div
      className={`flex items-center space-x-3 rounded-lg border p-4 shadow-lg transition-all duration-300 ${getVariantStyles()} ${className}`}
    >
      {getIcon()}
      <span className='text-sm font-medium'>{message}</span>
      <button
        onClick={onDismiss}
        className='text-green-300 transition-colors hover:text-green-100'
        aria-label='Dismiss toast'
      >
        <X size={16} />
      </button>
    </div>
  )
}
