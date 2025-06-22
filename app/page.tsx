'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { usePremiumStatus } from '@/hooks/usePremiumStatus'
import type { Database } from '@/types/supabase'
import type { User } from '@supabase/supabase-js'

export default function Home(): JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const {
    isPremium,
    isLoading: isPremiumLoading,
    error: premiumError
  } = usePremiumStatus()

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const getUser = async (): Promise<void> => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    void getUser()
  }, [supabase])

  // Redirect non-premium users to premium-required page
  // Only redirect if there's no error and user is confirmed to be non-premium
  useEffect(() => {
    console.log('[RootPage] Premium status check:', {
      user: !!user,
      isPremium,
      isPremiumLoading,
      premiumError
    })

    if (user && !isPremiumLoading && !isPremium && !premiumError) {
      console.log(
        '[RootPage] Redirecting non-premium user to /premium-required'
      )
      void router.push('/premium-required')
    }
  }, [user, isPremium, isPremiumLoading, router, premiumError])

  if (loading || isPremiumLoading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Welcome to 3B Saigon Jukebox
          </h1>
          <p className='mb-8 text-gray-400'>Please sign in to continue</p>
          <a
            href='/auth/signin'
            className='text-white rounded bg-green-500 px-4 py-2 font-bold hover:bg-green-600'
          >
            Sign In
          </a>
        </div>
      </div>
    )
  }

  // If there's a premium error (like token issues), show login button
  if (premiumError) {
    console.log('[RootPage] Premium error detected, showing re-authentication option')
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Authentication Issue
          </h1>
          <p className='mb-8 text-gray-400'>
            There was an issue with your Spotify connection. Please sign in again.
          </p>
          <a
            href='/auth/signin'
            className='text-white rounded bg-green-500 px-4 py-2 font-bold hover:bg-green-600'
          >
            Sign In Again
          </a>
        </div>
      </div>
    )
  }

  // Don't show admin button if user is not premium
  if (!isPremium) {
    console.log('[RootPage] User is not premium, showing redirect message')
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Redirecting...
          </h1>
          <p className='text-gray-400'>
            Please wait while we redirect you to the premium requirements page.
          </p>
        </div>
      </div>
    )
  }

  // Only show admin button for premium users
  console.log('[RootPage] User is premium, showing admin button')
  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='text-center'>
        <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
          Welcome, {user.email}!
        </h1>
        <p className='mb-8 text-gray-400'>You are signed in successfully.</p>
        <a
          href={`/${user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'user'}/admin`}
          className='text-white rounded bg-blue-500 px-4 py-2 font-bold hover:bg-blue-600'
        >
          Go to Admin
        </a>
      </div>
    </div>
  )
}
