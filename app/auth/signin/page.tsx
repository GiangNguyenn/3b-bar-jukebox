'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Database } from '@/types/supabase'
import { getOAuthRedirectUrl } from '@/shared/utils/domain'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { startFreshAuthentication } from '@/shared/utils/authCleanup'

export default function SignIn(): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const searchParams = useSearchParams()
  const hasInitiatedAuth = useRef(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check if we should force a fresh start
  const forceFresh = searchParams.get('fresh') === 'true'
  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const signInWithSpotify = async (): Promise<void> => {
      // Prevent multiple OAuth calls
      if (hasInitiatedAuth.current) {
        return
      }

      hasInitiatedAuth.current = true
      setError(null)

      try {
        // Check for existing session and clear it if needed
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData.session && forceFresh) {
          // If there's an existing session and we're forcing fresh login, sign out first
          await supabase.auth.signOut()
          // Add a small delay to ensure cleanup is complete
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const oauthRedirectUrl = getOAuthRedirectUrl()

        addLog(
          'INFO',
          `Initiating Spotify OAuth: ${JSON.stringify({
            redirectUrl: oauthRedirectUrl,
            forceFresh,
            timestamp: new Date().toISOString()
          })}`,
          'SignIn'
        )

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'spotify',
          options: {
            redirectTo: oauthRedirectUrl,
            scopes:
              'user-read-email user-read-private user-read-currently-playing user-read-playback-state user-modify-playback-state streaming playlist-modify-public playlist-modify-private user-library-read',
            queryParams: forceFresh
              ? {
                  show_dialog: 'true',
                  // Add timestamp to prevent caching
                  t: Date.now().toString()
                }
              : undefined
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
          // Check if we got a URL to redirect to
          if (data?.url) {
            // The redirect should happen automatically
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
  }, [supabase, addLog, forceFresh, error])

  const handleTryAgain = async (): Promise<void> => {
    setIsRetrying(true)
    try {
      await startFreshAuthentication()
    } catch (err) {
      console.error('Error during fresh authentication:', err)
      // Fallback: reset local state and reload
      hasInitiatedAuth.current = false
      setError(null)
      setIsRetrying(false)
      window.location.reload()
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='text-center'>
        <h1 className='mb-4 text-center font-[family-name:var(--font-belgrano)] text-4xl leading-tight text-primary-100'>
          {error ? 'Spotify Premium Required' : 'Redirecting to Spotify...'}
        </h1>
        <p className='text-gray-400'>
          {error
            ? 'This jukebox requires a Spotify Premium account. Please ensure you have Premium and try again.'
            : 'Please wait while we redirect you to Spotify for authentication.'}
        </p>

        {error && (
          <div className='mt-4 rounded-lg border border-green-500/30 bg-green-900/20 p-3'>
            <p className='text-sm text-green-300'>
              <strong>Premium Required:</strong> Free Spotify accounts cannot
              control playback or access the features needed for this jukebox.
            </p>
          </div>
        )}

        {error && (
          <p className='mt-3 text-xs text-gray-500'>
            Technical details: {error}
          </p>
        )}

        {error && (
          <div className='mt-4'>
            <div className='space-y-3'>
              <button
                onClick={() => void handleTryAgain()}
                disabled={isRetrying}
                className='text-white rounded bg-green-500 px-4 py-2 font-bold hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isRetrying
                  ? 'Clearing Session...'
                  : 'Try Again with Premium Account'}
              </button>
              <div className='text-center'>
                <a
                  href='https://www.spotify.com/premium/'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-sm text-blue-400 underline hover:text-blue-300'
                >
                  Don&apos;t have Premium? Upgrade your Spotify account
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
