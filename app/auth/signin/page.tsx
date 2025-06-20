'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useEffect } from 'react'
import type { Database } from '@/types/supabase'
import { getOAuthRedirectUrl } from '@/shared/utils/domain'

export default function SignIn(): JSX.Element {
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const signInWithSpotify = async (): Promise<void> => {
      console.log('[SignIn] Starting Spotify OAuth flow')

      const redirectUrl = getOAuthRedirectUrl()
      console.log('[SignIn] Window location origin:', window.location.origin)
      console.log('[SignIn] Full redirect URL:', redirectUrl)

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: redirectUrl
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

    void signInWithSpotify()
  }, [supabase])

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='text-center'>
        <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
          Redirecting to Spotify...
        </h1>
        <p className='text-gray-400'>
          Please wait while we redirect you to Spotify for authentication.
        </p>
      </div>
    </div>
  )
}
