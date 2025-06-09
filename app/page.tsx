'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { FaSpotify } from 'react-icons/fa'

const Home = (): JSX.Element => {
  const router = useRouter()
  const supabase = createClientComponentClient()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const checkUser = async (): Promise<void> => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (user) {
        // Get the user's profile to get their display_name
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .single()

        if (profile?.display_name) {
          // If user is logged in, redirect to their playlist page using display_name
          router.push(`/${profile.display_name}/playlist`)
        }
      }
    }

    void checkUser()
  }, [router, supabase])

  const handleLogin = async (): Promise<void> => {
    try {
      setIsLoading(true)
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback/supabase`,
          scopes: [
            'user-read-email',
            'playlist-modify-public',
            'playlist-modify-private',
            'playlist-read-private',
            'user-read-playback-state',
            'user-modify-playback-state',
            'user-read-private',
            'playlist-read-collaborative',
            'user-library-read',
            'user-library-modify'
          ].join(' ')
        }
      })

      if (error) {
        console.error('Error signing in:', error)
        return
      }

      if (data?.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error('Error in handleLogin:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    try {
      setIsLoading(true)
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Error signing out:', error)
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error('Error in handleSignOut:', error)
    } finally {
      setIsLoading(false)
    }
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

        <div className='mt-8 space-y-4'>
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className='text-white group relative flex w-full justify-center rounded-md bg-[#1DB954] px-3 py-3 text-sm font-semibold hover:bg-[#1ed760] focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:ring-offset-2 disabled:opacity-50'
          >
            <span className='absolute inset-y-0 left-0 flex items-center pl-3'>
              <FaSpotify className='h-5 w-5' />
            </span>
            {isLoading ? 'Loading...' : 'Sign in with Spotify'}
          </button>

          <button
            onClick={handleSignOut}
            disabled={isLoading}
            className='text-white group relative flex w-full justify-center rounded-md bg-gray-700 px-3 py-3 text-sm font-semibold hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50'
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

export default Home
