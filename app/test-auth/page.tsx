'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { type User } from '@supabase/supabase-js'

export default function TestAuth(): JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  )
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClientComponentClient()

  useEffect(() => {
    // Check for error in URL
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setError(decodeURIComponent(errorParam))
      setAuthState('error')
    }
  }, [searchParams])

  useEffect(() => {
    const getUser = async (): Promise<void> => {
      console.log('Fetching user...')
      try {
        const { data: { user }, error } = await supabase.auth.getUser()
        console.log('User fetch response:', { user, error })

        if (error) {
          console.error('Error fetching user:', error)
          setError(error.message)
          return
        }

        if (user) {
          setUser(user)
          // Create profile if it doesn't exist
          const response = await fetch('/api/auth/profile', {
            method: 'POST',
          })
          const data = await response.json()
          console.log('Profile creation response:', data)
        } else {
          setUser(null)
        }
      } catch (error) {
        console.error('Error in getUser:', error)
        setError(error instanceof Error ? error.message : 'An error occurred')
      } finally {
        console.log('Setting loading to false')
        setLoading(false)
      }
    }

    void getUser()
  }, [supabase])

  const handleLogin = async (): Promise<void> => {
    try {
      setError(null)
      setAuthState('loading')
      console.log('Starting login...')

      const { data, error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: `${window.location.origin}/test-auth/callback`,
          scopes: [
            'user-read-email',
            'user-read-private',
            'playlist-modify-public',
            'playlist-modify-private',
            'playlist-read-private',
            'playlist-read-collaborative',
            'user-read-playback-state',
            'user-modify-playback-state',
            'user-library-read',
            'user-library-modify'
          ].join(' ')
        }
      })

      console.log('Sign in response:', { data, error: signInError })

      if (signInError) {
        console.error('Sign in error:', signInError)
        throw signInError
      }

      if (data?.url) {
        console.log('Redirecting to:', data.url)
        window.location.href = data.url
      }
    } catch (err) {
      console.error('Error in handleLogin:', err)
      setError(err instanceof Error ? err.message : 'Failed to sign in')
      setAuthState('error')
    }
  }

  const handleLogout = async (): Promise<void> => {
    try {
      setError(null)
      console.log('Starting logout...')
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        console.error('Sign out error:', signOutError)
        throw signOutError
      }
      router.refresh()
    } catch (err) {
      console.error('Error in handleLogout:', err)
      setError(err instanceof Error ? err.message : 'Failed to sign out')
    }
  }

  async function createPlaylist() {
    try {
      console.log('Creating playlist...');
      const response = await fetch('/api/playlists', {
        method: 'POST',
      });
      const data = await response.json();
      console.log('Playlist creation response:', data);
      
      if (data.error) {
        setError(data.error);
      } else {
        setError(null);
      }
    } catch (error) {
      console.error('Error creating playlist:', error);
      setError(error instanceof Error ? error.message : 'Failed to create playlist');
    }
  }

  if (loading) {
    return (
      <div className='p-4'>
        <div className='text-center'>
          <div className='mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900'></div>
          <p className='mt-2'>Loading...</p>
          {error && <p className='mt-2 text-red-500'>Error: {error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold text-center mb-6">Auth Test Page</h1>
        
        {loading ? (
          <div className="flex justify-center items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative" role="alert">
                <span className="block sm:inline">{error}</span>
              </div>
            )}
            
            {user ? (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
                  <p>Logged in as: {user.email}</p>
                  <p>User ID: {user.id}</p>
                </div>
                
                <button
                  onClick={() => void createPlaylist()}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Create 3B Saigon Playlist
                </button>
                
                <button
                  onClick={() => void handleLogout()}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="text-center">
                <p className="mb-4">Not logged in</p>
                <button
                  onClick={() => void handleLogin()}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Login with Spotify
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
