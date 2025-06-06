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
      console.log('Getting user...')
      try {
        const { data, error: userError } = await supabase.auth.getUser()
        console.log('Auth response:', { data, error: userError })

        if (userError) {
          console.error('Auth error:', userError)
          // Don't treat "Auth session missing" as an error
          if (userError.message === 'Auth session missing!') {
            setError(null)
          } else {
            throw userError
          }
        }

        setUser(data.user)
      } catch (err) {
        console.error('Error in getUser:', err)
        setError(err instanceof Error ? err.message : 'Failed to get user')
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
          scopes: 'user-read-email user-read-private'
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
    <div className='p-4'>
      <h1 className='mb-4 text-2xl font-bold'>Supabase Auth Test</h1>

      {error && (
        <div className='mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700'>
          {error}
          <button
            onClick={() => setError(null)}
            className='float-right text-red-700 hover:text-red-900'
          >
            ×
          </button>
        </div>
      )}

      {user ? (
        <div>
          <p>Logged in as: {user.email}</p>
          <pre className='mt-4 rounded bg-gray-100 p-4'>
            {JSON.stringify(user, null, 2)}
          </pre>
          <button
            onClick={() => void handleLogout()}
            className='text-white mt-4 rounded bg-red-500 px-4 py-2 transition-colors hover:bg-red-600'
          >
            Logout
          </button>
        </div>
      ) : (
        <div className='space-y-4 text-center'>
          <p className='text-gray-600'>You are not logged in</p>
          <button
            onClick={() => void handleLogin()}
            disabled={authState === 'loading'}
            className={`text-white rounded bg-green-500 px-4 py-2 transition-colors hover:bg-green-600 ${
              authState === 'loading' ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            {authState === 'loading' ? 'Logging in...' : 'Login with Spotify'}
          </button>
          {authState === 'error' && (
            <p className='mt-2 text-red-500'>
              Failed to start login process. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
