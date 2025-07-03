'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useRef, useState } from 'react'
import type { Database } from '@/types/supabase'
import { getOAuthRedirectUrl } from '@/shared/utils/domain'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

export default function SignIn(): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const hasInitiatedAuth = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const signInWithSpotify = async (): Promise<void> => {
      // Prevent multiple OAuth calls
      if (hasInitiatedAuth.current) {
        addLog('INFO', 'OAuth already initiated, skipping', 'SignIn')
        return
      }

      hasInitiatedAuth.current = true
      setError(null)
      addLog('INFO', 'Starting OAuth flow with Spotify', 'SignIn')

      try {
        // Test Supabase configuration
        const {
          data: { session }
        } = await supabase.auth.getSession()
        addLog(
          'INFO',
          `Current session: ${session ? 'Exists' : 'None'}`,
          'SignIn'
        )

        const oauthRedirectUrl = getOAuthRedirectUrl()
        addLog('INFO', `OAuth redirect URL: ${oauthRedirectUrl}`, 'SignIn')

        // Check if we're already on the signin page to prevent loops
        if (window.location.pathname === '/auth/signin') {
          addLog(
            'INFO',
            'Already on signin page, proceeding with OAuth',
            'SignIn'
          )
        }

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'spotify',
          options: {
            redirectTo: oauthRedirectUrl,
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
          setError(error.message)
          // Reset the flag so user can try again
          hasInitiatedAuth.current = false
        } else {
          addLog(
            'INFO',
            'OAuth initiated successfully, redirecting to Spotify',
            'SignIn'
          )
          addLog(
            'INFO',
            `OAuth response data: ${JSON.stringify(data)}`,
            'SignIn'
          )

          // Check if we got a URL to redirect to
          if (data?.url) {
            addLog('INFO', `Redirecting to Spotify URL: ${data.url}`, 'SignIn')
            // The redirect should happen automatically, but let's log it
          } else {
            addLog('WARN', 'No redirect URL received from OAuth', 'SignIn')
            setError('No redirect URL received from OAuth')
            hasInitiatedAuth.current = false
          }
        }
      } catch (catchError) {
        addLog(
          'ERROR',
          'Unexpected error during OAuth:',
          'SignIn',
          catchError instanceof Error ? catchError : undefined
        )
        setError(
          catchError instanceof Error ? catchError.message : 'Unexpected error'
        )
        hasInitiatedAuth.current = false
      }
    }

    void signInWithSpotify()
  }, [supabase, addLog])

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='text-center'>
        <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
          {error ? 'Authentication Error' : 'Redirecting to Spotify...'}
        </h1>
        <p className='text-gray-400'>
          {error
            ? `Error: ${error}`
            : 'Please wait while we redirect you to Spotify for authentication.'}
        </p>

        {error && (
          <div className='mt-4'>
            <button
              onClick={() => {
                hasInitiatedAuth.current = false
                setError(null)
                window.location.reload()
              }}
              className='text-white rounded bg-green-500 px-4 py-2 font-bold hover:bg-green-600'
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
