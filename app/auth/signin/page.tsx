'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type { Database } from '@/types/supabase'

export default function SignIn() {
  const router = useRouter()
  
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const signInWithSpotify = async () => {
      console.log('[SignIn] Starting Spotify OAuth flow')
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback/supabase`
        }
      })

      if (error) {
        console.error('[SignIn] Error signing in:', {
          error,
          errorMessage: error.message,
          status: error.status,
          name: error.name
        })
        // Show error to user
        alert(`Login error: ${error.message}`)
      } else {
        console.log('[SignIn] OAuth flow initiated successfully:', data)
      }
    }

    signInWithSpotify()
  }, [supabase])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100 mb-4">
          Redirecting to Spotify...
        </h1>
        <p className="text-gray-400">
          Please wait while we redirect you to Spotify for authentication.
        </p>
      </div>
    </div>
  )
}
