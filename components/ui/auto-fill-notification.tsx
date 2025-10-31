'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

function formatDuration(ms: number | undefined): string {
  if (!ms) return '--:--'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

interface AutoFillNotificationData {
  trackName: string
  artistName: string
  albumName?: string
  albumArtUrl?: string | null
  allArtists?: string[]
  durationMs?: number
  popularity?: number
  explicit?: boolean | null
  isFallback: boolean
  timestamp: number
}

export function AutoFillNotification(): JSX.Element | null {
  const [notification, setNotification] =
    useState<AutoFillNotificationData | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect((): (() => void) => {
    const handleAutoFillNotification = (
      event: CustomEvent<AutoFillNotificationData>
    ): void => {
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

  const artistsDisplay =
    notification.allArtists && notification.allArtists.length > 0
      ? notification.allArtists.join(', ')
      : notification.artistName

  return (
    <div className='fixed right-4 top-4 z-50 duration-300 animate-in slide-in-from-right-2'>
      <div
        className={`bg-white max-w-md rounded-lg border p-4 shadow-lg ${notification.isFallback ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'} `}
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
            <div className='flex items-start space-x-3'>
              {notification.albumArtUrl && (
                <div className='relative h-16 w-16 flex-shrink-0 overflow-hidden rounded'>
                  <Image
                    src={notification.albumArtUrl}
                    alt={notification.albumName ?? 'Album cover'}
                    fill
                    className='object-cover'
                    sizes='64px'
                  />
                </div>
              )}
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium text-gray-900'>
                  {notification.isFallback
                    ? 'Fallback Track Added'
                    : 'Track Auto-Added'}
                </p>
                <p className='mt-1 text-sm font-medium text-gray-900'>
                  {notification.trackName}
                  {notification.explicit && (
                    <span className='text-white ml-2 inline-flex items-center rounded bg-gray-800 px-1.5 py-0.5 text-xs font-bold'>
                      E
                    </span>
                  )}
                </p>
                <p className='mt-0.5 text-sm text-gray-600'>
                  {artistsDisplay || 'Unknown Artist'}
                </p>
                <p className='mt-0.5 text-xs text-gray-500'>
                  {notification.albumName ?? 'Unknown Album'}
                </p>
                <div className='mt-2 flex items-center gap-3 text-xs text-gray-500'>
                  {notification.durationMs ? (
                    <span className='flex items-center gap-1'>
                      <svg
                        className='h-3 w-3'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      {formatDuration(notification.durationMs)}
                    </span>
                  ) : null}
                  {notification.popularity !== undefined ? (
                    <span className='flex items-center gap-1'>
                      <svg
                        className='h-3 w-3'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'
                        />
                      </svg>
                      {notification.popularity}/100
                    </span>
                  ) : null}
                </div>
                {notification.isFallback && (
                  <p className='mt-1 text-xs text-orange-600'>
                    Added from database when suggestions failed
                  </p>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={(): void => {
              setIsVisible(false)
            }}
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
