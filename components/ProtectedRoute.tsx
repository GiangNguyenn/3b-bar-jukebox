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
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const checkSession = async (): Promise<void> => {
      try {
        const {
          data: { session }
        } = await supabase.auth.getSession()
        if (!session) {
          router.push('/auth/signin')
          return
        }
        setIsLoading(false)
      } catch (error) {
        console.error('Error checking session:', error)
        router.push('/auth/signin')
      }
    }

    void checkSession()
  }, [router, supabase.auth])

  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='border-white h-8 w-8 animate-spin rounded-full border-2 border-t-transparent'></div>
      </div>
    )
  }

  return <>{children}</>
}
