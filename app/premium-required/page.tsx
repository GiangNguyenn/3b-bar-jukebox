'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { FaSpotify, FaCrown, FaMusic, FaPlay, FaSync } from 'react-icons/fa'
import { usePremiumStatus } from '@/hooks/usePremiumStatus'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { Loading } from '@/components/ui/loading'

export default function PremiumRequiredPage(): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSigningInAgain, setIsSigningInAgain] = useState(false)
  const {
    isPremium: usePremiumStatusPremium,
    productType,
    isLoading: isPremiumLoading,
    error: premiumError,
    refreshPremiumStatus,
    forceRefreshPremiumStatus
  } = usePremiumStatus()

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const checkUser = async (): Promise<void> => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) {
        // If no user, redirect to home
        router.push('/')
      }
    }

    void checkUser()
  }, [router, supabase])

  // If user becomes premium, redirect them to their admin page
  useEffect(() => {
    if (usePremiumStatusPremium && !isPremiumLoading) {
      const redirectToAdmin = async (): Promise<void> => {
        const {
          data: { user }
        } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .single()

          if (profile?.display_name) {
            router.push(`/${profile.display_name}/admin`)
          }
        }
      }
      void redirectToAdmin()
    }
  }, [usePremiumStatusPremium, isPremiumLoading, router, supabase])

  const handleUpgradeSpotify = (): void => {
    window.open('https://www.spotify.com/premium/', '_blank')
  }

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true)
    try {
      await supabase.auth.signOut()
      router.push('/')
    } catch (error) {
      addLog(
        'ERROR',
        'Error signing out:',
        'PremiumRequired',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsSigningOut(false)
    }
  }

  const handleRefreshStatus = async (): Promise<void> => {
    await refreshPremiumStatus()
  }

  const handleForceRefresh = async (): Promise<void> => {
    try {
      // Clear the premium verification cache by updating the verified_at timestamp
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('profiles')
          .update({ premium_verified_at: null })
          .eq('id', user.id)
      }

      // Now refresh the status with force parameter
      await forceRefreshPremiumStatus()
    } catch (error) {
      addLog(
        'ERROR',
        'Error force refreshing:',
        'PremiumRequired',
        error instanceof Error ? error : undefined
      )
    }
  }

  const handleSignInAgain = async (): Promise<void> => {
    setIsSigningInAgain(true)
    try {
      // Clear the user's profile data to ensure fresh start
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (user) {
        try {
          await supabase.from('profiles').delete().eq('id', user.id)
        } catch (error) {
          addLog(
            'ERROR',
            'Error clearing profile:',
            'PremiumRequired',
            error instanceof Error ? error : undefined
          )
        }
      }

      await supabase.auth.signOut()
      // Redirect to sign in page
      router.push('/auth/signin')

      // Add a timeout to reset the loading state if redirect doesn't happen immediately
      setTimeout(() => {
        setIsSigningInAgain(false)
      }, 3000)
    } catch (error) {
      addLog(
        'ERROR',
        'Error signing out:',
        'PremiumRequired',
        error instanceof Error ? error : undefined
      )
      setIsSigningInAgain(false)
    }
  }

  // Check if the error suggests re-authentication is needed
  const needsReAuth = premiumError
    ? premiumError.includes('sign in again') ||
      premiumError.includes('invalid') ||
      premiumError.includes('No Spotify access token')
    : false

  return (
    <div className='text-white min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black'>
      <div className='container mx-auto px-4 py-16'>
        <div className='mx-auto max-w-2xl text-center'>
          {/* Header */}
          <div className='mb-8'>
            <div className='mb-4 flex justify-center'>
              <div className='flex h-20 w-20 items-center justify-center rounded-full bg-green-500'>
                <FaSpotify className='text-white h-12 w-12' />
              </div>
            </div>
            <h1 className='mb-4 text-4xl font-bold'>Premium Required</h1>
            <p className='text-xl text-gray-300'>
              This jukebox requires a Spotify Premium account
            </p>

            {/* Current Account Status */}
            {!isPremiumLoading && (
              <div className='bg-white/10 mt-4 rounded-lg p-4 backdrop-blur-sm'>
                <p className='text-sm text-gray-300'>
                  <strong>Current Account:</strong> {productType || 'Unknown'}
                </p>
                {premiumError && (
                  <div className='mt-2'>
                    <p className='text-sm text-red-400'>
                      Error: {premiumError}
                    </p>
                    {needsReAuth && (
                      <p className='mt-1 text-sm text-yellow-400'>
                        Your Spotify connection may have expired. Try signing in
                        again.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Features Grid */}
          <div className='mb-8 grid gap-6 md:grid-cols-2'>
            <div className='bg-white/10 rounded-lg p-6 backdrop-blur-sm'>
              <div className='mb-3 flex justify-center'>
                <FaCrown className='h-8 w-8 text-yellow-400' />
              </div>
              <h3 className='mb-2 text-lg font-semibold'>Premium Features</h3>
              <p className='text-sm text-gray-300'>
                Control playback, manage devices, and access advanced jukebox
                features
              </p>
            </div>

            <div className='bg-white/10 rounded-lg p-6 backdrop-blur-sm'>
              <div className='mb-3 flex justify-center'>
                <FaMusic className='h-8 w-8 text-green-400' />
              </div>
              <h3 className='mb-2 text-lg font-semibold'>Full Control</h3>
              <p className='text-sm text-gray-300'>
                Play, pause, skip tracks, and manage your jukebox queue
              </p>
            </div>

            <div className='bg-white/10 rounded-lg p-6 backdrop-blur-sm'>
              <div className='mb-3 flex justify-center'>
                <FaPlay className='h-8 w-8 text-blue-400' />
              </div>
              <h3 className='mb-2 text-lg font-semibold'>Device Management</h3>
              <p className='text-sm text-gray-300'>
                Connect and control multiple devices for seamless playback
              </p>
            </div>

            <div className='bg-white/10 rounded-lg p-6 backdrop-blur-sm'>
              <div className='mb-3 flex justify-center'>
                <FaSpotify className='h-8 w-8 text-green-400' />
              </div>
              <h3 className='mb-2 text-lg font-semibold'>
                Spotify Integration
              </h3>
              <p className='text-sm text-gray-300'>
                Full access to Spotify&apos;s premium API features
              </p>
            </div>
          </div>

          {/* Why Premium */}
          <div className='bg-white/5 mb-8 rounded-lg p-6 backdrop-blur-sm'>
            <h2 className='mb-4 text-2xl font-semibold'>Why Premium?</h2>
            <div className='space-y-3 text-left'>
              <div className='flex items-start gap-3'>
                <div className='mt-1 h-2 w-2 rounded-full bg-green-400'></div>
                <p className='text-sm text-gray-300'>
                  <strong>Playback Control:</strong> Premium accounts can
                  control playback, pause, resume, and skip tracks
                </p>
              </div>
              <div className='flex items-start gap-3'>
                <div className='mt-1 h-2 w-2 rounded-full bg-green-400'></div>
                <p className='text-sm text-gray-300'>
                  <strong>Device Management:</strong> Premium accounts can
                  manage and transfer playback between devices
                </p>
              </div>
              <div className='flex items-start gap-3'>
                <div className='mt-1 h-2 w-2 rounded-full bg-green-400'></div>
                <p className='text-sm text-gray-300'>
                  <strong>Queue Management:</strong> Premium accounts can view
                  and modify the playback queue
                </p>
              </div>
              <div className='flex items-start gap-3'>
                <div className='mt-1 h-2 w-2 rounded-full bg-green-400'></div>
                <p className='text-sm text-gray-300'>
                  <strong>Real-time State:</strong> Premium accounts can access
                  real-time playback state information
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className='flex flex-col gap-4 sm:flex-row sm:justify-center'>
            <button
              onClick={handleUpgradeSpotify}
              className='text-white flex items-center justify-center gap-2 rounded-lg bg-green-600 px-6 py-3 font-semibold transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-black'
            >
              <FaSpotify className='h-5 w-5' />
              Upgrade to Spotify Premium
            </button>
            <button
              onClick={() => void handleRefreshStatus()}
              disabled={isPremiumLoading}
              className='text-white flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isPremiumLoading ? (
                <Loading className='h-5 w-5' />
              ) : (
                <FaSync className='h-5 w-5' />
              )}
              {isPremiumLoading ? 'Checking...' : 'Refresh Status'}
            </button>
            <button
              onClick={() => void handleForceRefresh()}
              disabled={isPremiumLoading}
              className='text-white flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-6 py-3 font-semibold transition-colors hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50'
            >
              <FaSync className='h-5 w-5' />
              Force Refresh
            </button>
            {needsReAuth && (
              <button
                onClick={() => void handleSignInAgain()}
                disabled={isSigningInAgain}
                className='text-white flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-6 py-3 font-semibold transition-colors hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50'
              >
                <FaSync className='h-5 w-5' />
                {isSigningInAgain ? 'Signing Out...' : 'Sign In Again'}
              </button>
            )}
            <button
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className='text-white hover:bg-white/10 focus:ring-white flex items-center justify-center gap-2 rounded-lg border border-gray-600 bg-transparent px-6 py-3 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isSigningOut ? 'Signing Out...' : 'Sign Out'}
            </button>
          </div>

          {/* Footer */}
          <div className='mt-8 text-sm text-gray-400'>
            <p>
              Already have Premium? Try{' '}
              <button
                onClick={() => void handleRefreshStatus()}
                className='text-green-400 underline hover:text-green-300'
              >
                refreshing your status
              </button>{' '}
              or contact support if you continue to see this message.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
