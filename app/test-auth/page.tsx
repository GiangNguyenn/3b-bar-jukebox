'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Image from 'next/image'
import type { Database } from '@/types/supabase'

interface Profile {
  id: string
  spotify_user_id: string
  display_name: string
  avatar_url?: string
}

interface ProfileResponse {
  data: Profile | null
  error: Error | null
}

export default function TestAuth(): JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const router = useRouter()
  const supabase = createClientComponentClient<Database>()

  async function handleSignIn(): Promise<void> {
    try {
      setIsLoading(true)
      setError(null)

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: `${window.location.origin}/test-auth`
        }
      })

      if (error) {
        console.error('Error signing in:', error)
      }
    } catch (error) {
      console.error('Error during sign in:', error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSignOut(): Promise<void> {
    try {
      setIsLoading(true)
      setError(null)

      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Error signing out:', error)
      } else {
        setProfile(null)
        router.refresh()
      }
    } catch (error) {
      console.error('Error during sign out:', error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreateProfile(): Promise<void> {
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'POST'
      })
      const data = (await response.json()) as
        | { message: string }
        | { error: string }
      console.log('Profile creation response:', data)
      router.refresh()
    } catch (error) {
      console.error('Error creating profile:', error)
    }
  }

  async function handleGetProfile(): Promise<void> {
    try {
      setIsLoading(true)
      setError(null)

      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) {
        console.log('No user found')
        return
      }

      const response = (await supabase
        .from('profiles')
        .select()
        .eq('id', user.id)
        .single()) as ProfileResponse

      const { data: profile, error } = response

      if (error) {
        console.error('Error fetching profile:', error)
        return
      }

      if (!profile) {
        console.log('No profile found')
        return
      }

      console.log('Profile data:', {
        id: profile.id,
        spotify_user_id: profile.spotify_user_id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url
      })

      setProfile(profile)
    } catch (error) {
      console.error('Error getting profile:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='min-h-screen bg-gray-100 px-4 py-12 sm:px-6 lg:px-8'>
      <div className='bg-white mx-auto max-w-md rounded-lg p-6 shadow-md'>
        <h1 className='mb-6 text-2xl font-bold text-gray-900'>
          Auth Test Page
        </h1>

        <div className='space-y-4'>
          <button
            onClick={() => void handleSignIn()}
            disabled={isLoading}
            className='text-white w-full rounded-md bg-green-600 px-4 py-2 hover:bg-green-700 disabled:opacity-50'
          >
            {isLoading ? 'Loading...' : 'Sign in with Spotify'}
          </button>

          <button
            onClick={() => void handleSignOut()}
            disabled={isLoading}
            className='text-white w-full rounded-md bg-red-600 px-4 py-2 hover:bg-red-700 disabled:opacity-50'
          >
            {isLoading ? 'Loading...' : 'Sign Out'}
          </button>

          <button
            onClick={() => void handleCreateProfile()}
            disabled={isLoading}
            className='text-white w-full rounded-md bg-blue-600 px-4 py-2 hover:bg-blue-700 disabled:opacity-50'
          >
            {isLoading ? 'Loading...' : 'Create Profile'}
          </button>

          <button
            onClick={() => void handleGetProfile()}
            disabled={isLoading}
            className='text-white w-full rounded-md bg-purple-600 px-4 py-2 hover:bg-purple-700 disabled:opacity-50'
          >
            {isLoading ? 'Loading...' : 'Get Profile'}
          </button>

          {error && (
            <div className='rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700'>
              {error}
            </div>
          )}

          {profile && (
            <div className='rounded-md border border-gray-200 bg-gray-50 p-4'>
              <h2 className='mb-2 text-lg font-semibold'>Profile</h2>
              <div className='space-y-2'>
                <p>
                  <span className='font-medium'>ID:</span> {profile.id}
                </p>
                <p>
                  <span className='font-medium'>Spotify User ID:</span>{' '}
                  {profile.spotify_user_id}
                </p>
                <p>
                  <span className='font-medium'>Display Name:</span>{' '}
                  {profile.display_name}
                </p>
                {profile.avatar_url && (
                  <div>
                    <span className='font-medium'>Avatar:</span>
                    <Image
                      src={profile.avatar_url}
                      alt='Profile'
                      width={64}
                      height={64}
                      className='mt-2 rounded-full'
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
