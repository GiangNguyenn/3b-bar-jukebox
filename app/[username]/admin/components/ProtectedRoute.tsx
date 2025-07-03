'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { Loading } from '@/components/ui/loading'

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

        // Step 1: Check if user has valid Spotify authentication
        const tokenResponse = await fetch('/api/token', {
          credentials: 'include'
        })

        if (!tokenResponse.ok) {
          router.push('/auth/signin')
          return
        }

        // Step 2: Now that we have valid Spotify authentication, check premium status
        const premiumResponse = await fetch('/api/auth/verify-premium', {
          credentials: 'include'
        })

        if (premiumResponse.ok) {
          const premiumData = (await premiumResponse.json()) as {
            isPremium: boolean
          }
          if (!premiumData.isPremium) {
            // Non-premium user, redirect to premium required page
            router.push('/premium-required')
            return
          }
          setIsPremium(true)
        } else {
          // Premium verification failed, check if it's a token issue
          const errorData = (await premiumResponse
            .json()
            .catch(() => ({}))) as { code?: string }

          // For authentication errors (token issues), redirect to signin page
          if (
            errorData.code === 'NO_SPOTIFY_TOKEN' ||
            errorData.code === 'INVALID_SPOTIFY_TOKEN'
          ) {
            router.push('/auth/signin')
            return
          }

          // For other errors, redirect to root page to allow the app to handle it
          router.push('/')
          return
        }

        setIsLoading(false)
      } catch {
        // For any errors, redirect to root page to allow re-authentication
        router.push('/')
      }
    }

    void checkSessionAndPremium()
  }, [router, supabase.auth])

  if (isLoading) {
    return <Loading fullScreen />
  }

  // Only render children if user is premium
  if (!isPremium) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Redirecting...
          </h1>
          <p className='text-gray-400'>
            Please wait while we redirect you to the appropriate page.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
