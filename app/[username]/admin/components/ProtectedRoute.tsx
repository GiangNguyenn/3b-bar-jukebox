'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

export function ProtectedRoute({
  children
}: {
  children: React.ReactNode
}): JSX.Element {
  const router = useRouter()
  const [isPremium, setIsPremium] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const checkSessionAndPremium = async (): Promise<void> => {
      try {
        const {
          data: { session }
        } = await supabase.auth.getSession()
        if (!session) {
          router.push('/auth/signin')
          return
        }

        // Check premium status
        const premiumResponse = await fetch('/api/auth/verify-premium', {
          credentials: 'include'
        })

        if (premiumResponse.ok) {
          const premiumData = await premiumResponse.json()
          if (!premiumData.isPremium) {
            // Non-premium user, redirect to premium required page
            router.push('/premium-required')
            return
          }
          setIsPremium(true)
        } else {
          // Premium verification failed, redirect to premium required page
          router.push('/premium-required')
          return
        }

        setIsLoading(false)
      } catch (error) {
        console.error('Error checking session or premium status:', error)
        router.push('/auth/signin')
      }
    }

    void checkSessionAndPremium()
  }, [router, supabase.auth])

  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='border-white h-8 w-8 animate-spin rounded-full border-2 border-t-transparent'></div>
      </div>
    )
  }

  // Only render children if user is premium
  if (!isPremium) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100 mb-4'>
            Redirecting...
          </h1>
          <p className='text-gray-400'>
            Please wait while we redirect you to the premium requirements page.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
