'use client'

import { useEffect, useState } from 'react'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('AutoFillNotification')

interface AutoFillNotificationData {
  trackName: string
  artistName: string
  isFallback: boolean
  timestamp: number
}

export function AutoFillNotification(): JSX.Element | null {
  const [notification, setNotification] =
    useState<AutoFillNotificationData | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const handleAutoFillNotification = (
      event: CustomEvent<AutoFillNotificationData>
    ): void => {
      logger(
        'INFO',
        `Auto-fill notification received: ${event.detail.trackName} by ${event.detail.artistName}`
      )
      setNotification(event.detail)
      setIsVisible(true)

      // Auto-hide after 5 seconds
      setTimeout(() => {
        setIsVisible(false)
        // Clear notification after fade out
        setTimeout(() => {
          setNotification(null)
        }, 300)
      }, 5000)
    }

    // Add event listener only on client side
    if (typeof window !== 'undefined') {
      window.addEventListener(
        'autoFillNotification',
        handleAutoFillNotification as EventListener
      )

      // Cleanup
      return () => {
        window.removeEventListener(
          'autoFillNotification',
          handleAutoFillNotification as EventListener
        )
      }
    }

    // Return empty cleanup function for server-side rendering
    return () => {}
  }, [])

  if (!notification || !isVisible) {
    return null
  }

  return (
    <div className='fixed right-4 top-4 z-50 duration-300 animate-in slide-in-from-right-2'>
      <div
        className={`bg-white max-w-sm rounded-lg border p-4 shadow-lg ${notification.isFallback ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'} `}
      >
        <div className='flex items-start space-x-3'>
          <div
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${notification.isFallback ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'} `}
          >
            {notification.isFallback ? (
              <svg
                className='h-4 w-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M13 10V3L4 14h7v7l9-11h-7z'
                />
              </svg>
            ) : (
              <svg
                className='h-4 w-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 6v6m0 0v6m0-6h6m-6 0H6'
                />
              </svg>
            )}
          </div>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium text-gray-900'>
              {notification.isFallback
                ? 'Fallback Track Added'
                : 'Track Auto-Added'}
            </p>
            <p className='mt-1 text-sm text-gray-600'>
              <span className='font-medium'>{notification.trackName}</span>
              <span className='text-gray-500'>
                {' '}
                by {notification.artistName}
              </span>
            </p>
            {notification.isFallback && (
              <p className='mt-1 text-xs text-orange-600'>
                Added from database when suggestions failed
              </p>
            )}
          </div>
          <button
            onClick={(): void => setIsVisible(false)}
            className='flex-shrink-0 text-gray-400 transition-colors hover:text-gray-600'
          >
            <svg
              className='h-4 w-4'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
