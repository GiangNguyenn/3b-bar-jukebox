'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

const Home = (): JSX.Element => {
  const router = useRouter()
  const supabase = createClientComponentClient()

  useEffect(() => {
    const checkUser = async (): Promise<void> => {
      const { data: { user } } = await supabase.auth.getUser()
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
    }
  }

  return (
    <div className='flex min-h-screen flex-col items-center justify-center p-4'>
      <div className='text-center'>
        <h1 className='mb-4 text-4xl font-bold'>3B Saigon Jukebox</h1>
        <p className='mb-8 text-lg text-gray-600'>
          Create and manage your own playlist for the bar
        </p>
        <button
          onClick={() => void handleLogin()}
          className='rounded-full bg-green-500 px-8 py-3 text-lg font-semibold text-white hover:bg-green-600'
        >
          Sign in with Spotify
        </button>
      </div>
    </div>
  )
}

export default Home
