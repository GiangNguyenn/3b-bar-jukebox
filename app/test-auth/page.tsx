'use client'

import { useSession, signIn, signOut } from 'next-auth/react'

export default function TestAuth(): JSX.Element {
  const { data: session, status } = useSession()

  const handleSignIn = (): void => {
    void signIn('spotify')
  }

  const handleSignOut = (): void => {
    void signOut()
  }

  if (status === 'loading') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-black'>
        <div className='text-white'>Loading...</div>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-black p-4'>
      <div className='w-full max-w-md space-y-8 rounded-lg bg-gray-900 p-8 shadow-lg'>
        <div className='text-center'>
          <h2 className='text-white text-2xl font-bold'>
            Auth Status: {status}
          </h2>

          {session ? (
            <div className='mt-4 space-y-4'>
              <div className='rounded bg-gray-800 p-4'>
                <h3 className='text-white mb-2 text-lg font-semibold'>
                  Session Data:
                </h3>
                <pre className='whitespace-pre-wrap text-sm text-gray-300'>
                  {JSON.stringify(session, null, 2)}
                </pre>
              </div>

              <button
                onClick={handleSignOut}
                className='text-white w-full rounded-md bg-red-600 px-4 py-2 hover:bg-red-700'
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className='mt-4'>
              <button
                onClick={handleSignIn}
                className='text-white w-full rounded-md bg-[#1DB954] px-4 py-2 hover:bg-[#1ed760]'
              >
                Sign In with Spotify
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
