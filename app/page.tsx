'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { usePremiumStatus } from '@/hooks/usePremiumStatus'
import type { Database } from '@/types/supabase'

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const { isPremium, isLoading: isPremiumLoading, error: premiumError } = usePremiumStatus()

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    getUser()
  }, [supabase])

  // Redirect non-premium users to premium-required page
  useEffect(() => {
    console.log('[RootPage] Premium status check:', {
      user: !!user,
      isPremium,
      isPremiumLoading,
      premiumError
    })
    
    if (user && !isPremiumLoading && !isPremium) {
      console.log('[RootPage] Redirecting non-premium user to /premium-required')
      router.push('/premium-required')
    }
  }, [user, isPremium, isPremiumLoading, router, premiumError])

  if (loading || isPremiumLoading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100 mb-4">
            Welcome to 3B Saigon Jukebox
          </h1>
          <p className="text-gray-400 mb-8">
            Please sign in to continue
          </p>
          <a
            href="/auth/signin"
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded"
          >
            Sign In
          </a>
        </div>
      </div>
    )
  }

  // Don't show admin button if user is not premium
  if (!isPremium) {
    console.log('[RootPage] User is not premium, showing redirect message')
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100 mb-4">
            Redirecting...
          </h1>
          <p className="text-gray-400">
            Please wait while we redirect you to the premium requirements page.
          </p>
        </div>
      </div>
    )
  }

  // Only show admin button for premium users
  console.log('[RootPage] User is premium, showing admin button')
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100 mb-4">
          Welcome, {user.email}!
        </h1>
        <p className="text-gray-400 mb-8">
          You are signed in successfully.
        </p>
        <a
          href={`/${user.user_metadata?.full_name || user.email?.split('@')[0] || 'user'}/admin`}
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
        >
          Go to Admin
        </a>
      </div>
    </div>
  )
}
