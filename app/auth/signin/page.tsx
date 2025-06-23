'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useEffect } from 'react'
import type { Database } from '@/types/supabase'
import { getOAuthRedirectUrl } from '@/shared/utils/domain'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

export default function SignIn(): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const signInWithSpotify = async (): Promise<void> => {
      const redirectUrl = getOAuthRedirectUrl()

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: redirectUrl,
          scopes:
            'user-read-email user-read-private user-read-currently-playing user-read-playback-state user-modify-playback-state streaming playlist-modify-public playlist-modify-private'
        }
      })

      if (error) {
        addLog(
          'ERROR',
          `Error signing in: ${JSON.stringify({ errorMessage: error.message, status: error.status, name: error.name })}`,
          'SignIn'
        )
        // Show error to user
        alert(`Login error: ${error.message}`)
      }
    }

    void signInWithSpotify()
  }, [supabase, addLog])

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
