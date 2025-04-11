'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import logo from '../app/public/logo.png'

interface ErrorDetails {
  errorMessage?: string
  status?: number
  details?: unknown
}

interface ApiErrorResponse {
  error?: string
  details?: {
    errorMessage?: string
  }
}

interface TrackSuggestionResponse {
  success: boolean
  message: string
  searchDetails?: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails: Array<{
      name: string
      popularity: number
      isExcluded: boolean
    }>
  }
}

interface PlaylistRefreshEvent extends CustomEvent {
  detail: {
    timestamp: number
  }
}

declare global {
  interface WindowEventMap {
    playlistRefresh: PlaylistRefreshEvent
  }
}

const Header = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogoClick = async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Log environment info
      console.log('Making request from:', {
        environment: process.env.NODE_ENV,
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
        vercelUrl: process.env.VERCEL_URL,
        windowLocation:
          typeof window !== 'undefined'
            ? window.location.origin
            : 'server-side',
      })

      const response = await fetch('/api/refresh-site', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok) {
        const data = (await response.json()) as ApiErrorResponse
        const errorMessage =
          data.error ||
          data.details?.errorMessage ||
          'Failed to suggest a track'
        console.error('API error:', {
          status: response.status,
          statusText: response.statusText,
          data,
        })
        throw new Error(errorMessage)
      }

      const data = (await response.json()) as TrackSuggestionResponse
      console.log('Track suggestion response:', data)

      // If track was successfully added, dispatch a refresh event
      if (data.success) {
        console.log('Dispatching playlist refresh event...')
        try {
          // Create and dispatch the event
          const event = new CustomEvent<PlaylistRefreshEvent['detail']>(
            'playlistRefresh',
            {
              detail: { timestamp: Date.now() },
              bubbles: true,
              composed: true,
            },
          )

          // Dispatch from both window and document to ensure maximum compatibility
          window.dispatchEvent(event)
          document.dispatchEvent(event)

          console.log('Playlist refresh event dispatched successfully')
        } catch (eventError) {
          console.error('Error dispatching playlist refresh event:', eventError)
        }
      } else {
        console.log(
          'Track was not successfully added, not dispatching refresh event',
        )
      }
    } catch (error) {
      console.error('Error suggesting track:', error)
      let errorMessage = 'Failed to suggest a track'

      if (error instanceof Error) {
        // Handle network errors
        if (
          error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError')
        ) {
          errorMessage =
            'Network error. Please check your connection and try again.'
        } else {
          errorMessage = error.message
        }

        // Log additional error details
        if ('details' in error) {
          const errorDetails = (error as Error & { details: ErrorDetails })
            .details
          console.error('Error details:', errorDetails)
        }
      }

      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='flex flex-col items-center justify-center space-y-4 p-4'>
      <div className='relative cursor-pointer' onClick={handleLogoClick}>
        <Image
          src={logo}
          width={100}
          height={100}
          alt='3B SAIGON JUKEBOX Logo'
          priority
          className={`transition-transform duration-200 hover:scale-105 ${isLoading ? 'animate-spin' : ''}`}
        />
      </div>
      <h1 className='text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
        3B SAIGON JUKEBOX
      </h1>
      {error && (
        <div className='text-white fixed bottom-4 right-4 max-w-md rounded bg-red-500 px-4 py-2 shadow-lg'>
          <p className='font-bold'>Error:</p>
          <p className='text-sm'>{error}</p>
        </div>
      )}
    </div>
  )
}

export default Header
