'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { Loading } from '@/components/ui/loading'
import { useMetadataBackfill } from '@/hooks/useMetadataBackfill'

export function ProtectedRoute({
  children
}: {
  children: React.ReactNode
}): JSX.Element {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnon
  const router = useRouter()
  const params = useParams()
  const username = params?.username as string | undefined
  const [isPremium, setIsPremium] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const supabase = useMemo(() => {
    if (missingEnv || !supabaseUrl || !supabaseAnon) {
      return null
    }
    return createBrowserClient<Database>(supabaseUrl, supabaseAnon)
  }, [missingEnv, supabaseUrl, supabaseAnon])

  useEffect(() => {
    if (missingEnv || !supabase) return
    const redirectTo = (path: string): void => {
      router.push(path)
    }

    const checkSessionAndPremium = async (): Promise<void> => {
      try {
        const {
          data: { session }
        } = await supabase.auth.getSession()
        if (!session) {
          redirectTo('/auth/signin')
          return
        }

        const user = session.user

        // Check verification if username is present in URL
        if (username && user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, display_name')
            .eq('id', user.id)
            .single()

          // If no profile found, or display_name mismatch (and not using UUID), redirect
          // We allow matching either display_name (case-insensitive) or ID
          const isMatch =
            profile &&
            (profile.display_name?.toLowerCase() === username.toLowerCase() ||
              profile.id === username)

          if (!isMatch) {
            // Logged in but trying to access someone else's admin page
            redirectTo('/')
            return
          }
        }

        const tokenResponse = await fetch('/api/token', {
          credentials: 'include'
        })

        if (!tokenResponse.ok) {
          redirectTo('/auth/signin')
          return
        }

        const premiumResponse = await fetch('/api/auth/verify-premium', {
          credentials: 'include'
        })

        if (premiumResponse.ok) {
          const premiumData = (await premiumResponse.json()) as {
            isPremium: boolean
          }
          if (!premiumData.isPremium) {
            redirectTo('/premium-required')
            return
          }
          setIsPremium(true)
        } else {
          const errorData = (await premiumResponse
            .json()
            .catch(() => ({}))) as { code?: string }

          if (
            errorData.code === 'NO_SPOTIFY_TOKEN' ||
            errorData.code === 'INVALID_SPOTIFY_TOKEN'
          ) {
            redirectTo('/auth/signin')
            return
          }

          redirectTo('/')
          return
        }

        setIsLoading(false)
      } catch {
        redirectTo('/')
      }
    }

    void checkSessionAndPremium()
  }, [router, supabase, missingEnv])

  // Run metadata backfill in background for authenticated admins
  useMetadataBackfill()

  if (missingEnv) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
            Configuration Error
          </h1>
          <p className='text-gray-400'>
            Missing Supabase client environment variables.
          </p>
        </div>
      </div>
    )
  }

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
