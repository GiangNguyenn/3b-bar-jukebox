'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function ErrorPage(): JSX.Element {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-black'>
      <div className='w-full max-w-md space-y-8 rounded-lg bg-gray-900 p-8 shadow-lg'>
        <div className='text-center'>
          <h2 className='text-white mt-6 text-3xl font-bold tracking-tight'>
            Authentication Error
          </h2>
          <p className='mt-2 text-sm text-gray-400'>
            {error === 'AccessDenied'
              ? 'You need to grant the required permissions to use this app.'
              : 'An error occurred during authentication.'}
          </p>
        </div>

        <div className='mt-8'>
          <Link
            href='/auth/signin'
            className='text-white group relative flex w-full justify-center rounded-md bg-[#1DB954] px-3 py-3 text-sm font-semibold hover:bg-[#1ed760] focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:ring-offset-2'
          >
            Try Again
          </Link>
        </div>
      </div>
    </div>
  )
}
