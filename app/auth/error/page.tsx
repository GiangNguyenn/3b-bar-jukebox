'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { startFreshAuthentication } from '@/shared/utils/authCleanup'

export default function ErrorPage(): JSX.Element {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const [isRetrying, setIsRetrying] = useState(false)

  const handleTryAgain = async (): Promise<void> => {
    setIsRetrying(true)
    try {
      await startFreshAuthentication()
    } catch (err) {
      console.error('Error during fresh authentication:', err)
      // Fallback to direct navigation
      window.location.href = '/auth/signin'
    }
  }

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-black'>
      <div className='w-full max-w-md space-y-8 rounded-lg bg-gray-900 p-8 shadow-lg'>
        <div className='text-center'>
          <h2 className='text-white mt-6 text-3xl font-bold tracking-tight'>
            Spotify Premium Required
          </h2>
          <p className='mt-2 text-sm text-gray-400'>
            This jukebox requires a Spotify Premium account to function
            properly.
            {error === 'AccessDenied'
              ? ' Please ensure you have a Premium account and grant the required permissions.'
              : ' Please upgrade your Spotify account to Premium and try again.'}
          </p>
          <div className='mt-4 rounded-lg border border-green-500/30 bg-green-900/20 p-3'>
            <p className='text-sm text-green-300'>
              <strong>Why Premium?</strong> Premium accounts can control
              playback, manage devices, and access the features needed for this
              jukebox to work.
            </p>
          </div>
          {error && (
            <p className='mt-3 text-xs text-gray-500'>
              Technical details: {error}
            </p>
          )}
        </div>

        <div className='mt-8 space-y-3'>
          <Link
            href='/premium-required'
            className='text-white group relative flex w-full justify-center rounded-md bg-green-600 px-3 py-3 text-sm font-semibold hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2'
          >
            Learn More About Premium Requirements
          </Link>
          <button
            onClick={() => void handleTryAgain()}
            disabled={isRetrying}
            className='text-white group relative flex w-full justify-center rounded-md bg-[#1DB954] px-3 py-3 text-sm font-semibold hover:bg-[#1ed760] focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isRetrying
              ? 'Clearing Session...'
              : 'Try Again with Premium Account'}
          </button>
          <a
            href='https://www.spotify.com/premium/'
            target='_blank'
            rel='noopener noreferrer'
            className='text-white hover:bg-white/10 focus:ring-white group relative flex w-full justify-center rounded-md border border-gray-600 bg-transparent px-3 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2'
          >
            Upgrade to Spotify Premium
          </a>
        </div>
      </div>
    </div>
  )
}
