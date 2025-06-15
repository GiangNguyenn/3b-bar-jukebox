'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export function ProtectedRoute({
  children
}: {
  children: React.ReactNode
}): JSX.Element {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClientComponentClient()

  useEffect(() => {
    const checkSession = async (): Promise<void> => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/login')
          return
        }
        setIsLoading(false)
      } catch (error) {
        console.error('Error checking session:', error)
        router.push('/login')
      }
    }

    void checkSession()
  }, [router, supabase.auth])

  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent'></div>
      </div>
    )
  }

  return <>{children}</>
} 