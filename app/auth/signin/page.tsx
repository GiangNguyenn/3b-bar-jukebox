'use client'

import { signIn } from 'next-auth/react'
import { FaSpotify } from 'react-icons/fa'

export default function SignIn(): JSX.Element {
  const handleSignIn = (): void => {
    void signIn('spotify', { callbackUrl: '/' })
  }

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-black'>
      <div className='w-full max-w-md space-y-8 rounded-lg bg-gray-900 p-8 shadow-lg'>
        <div className='text-center'>
          <h2 className='text-white mt-6 text-3xl font-bold tracking-tight'>
            Welcome to JM Bar Jukebox
          </h2>
          <p className='mt-2 text-sm text-gray-400'>
            Sign in with your Spotify account to continue
          </p>
        </div>

        <div className='mt-8'>
          <button
            onClick={handleSignIn}
            className='text-white group relative flex w-full justify-center rounded-md bg-[#1DB954] px-3 py-3 text-sm font-semibold hover:bg-[#1ed760] focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:ring-offset-2'
          >
            <span className='absolute inset-y-0 left-0 flex items-center pl-3'>
              <FaSpotify className='h-5 w-5' />
            </span>
            Sign in with Spotify
          </button>
        </div>
      </div>
    </div>
  )
}
