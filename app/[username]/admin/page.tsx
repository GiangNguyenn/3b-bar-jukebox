'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  useSpotifyPlayerStore,
  useAdminSpotifyPlayerHook
} from '@/hooks/useSpotifyPlayer'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import { useTrackSuggestions } from './components/track-suggestions/hooks/useTrackSuggestions'
import { useSpotifyHealthMonitor } from '@/hooks/useSpotifyHealthMonitor'
import { HealthStatusSection } from './components/dashboard/health-status-section'
import { JukeboxSection } from './components/dashboard/components/jukebox-section'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import { AnalyticsTab } from './components/analytics/analytics-tab'
import { BrandingTab } from './components/branding/branding-tab'
import { SubscriptionTab } from './components/subscription/subscription-tab'
import { PremiumNotice } from './components/PremiumNotice'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'
import { getAutoPlayService } from '@/services/autoPlayService'

import { useSubscription } from '@/hooks/useSubscription'
import { useGetProfile } from '@/hooks/useGetProfile'
import { startFreshAuthentication } from '@/shared/utils/authCleanup'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'

// Autoplay helper removed

function useAdminTokenManagement(params: {
  tokenHealthStatus: 'valid' | 'error' | 'unknown' | 'expired'
  isLoading: boolean
  isReady: boolean
  handleTokenError: () => Promise<void>
  addLog: (
    level: 'WARN' | 'ERROR' | 'INFO' | 'LOG',
    message: string,
    context?: string,
    error?: Error
  ) => void
}): void {
  const { tokenHealthStatus, isLoading, isReady, handleTokenError, addLog } =
    params

  useEffect(() => {
    if (tokenHealthStatus === 'error' && !isLoading && isReady) {
      void handleTokenError()
    }
  }, [tokenHealthStatus, isLoading, isReady, handleTokenError])

  useEffect(() => {
    if (!isReady) return

    const interval = setInterval(() => {
      const runRefresh: () => Promise<void> = async (): Promise<void> => {
        try {
          await tokenManager.refreshIfNeeded()
        } catch (error: unknown) {
          addLog(
            'ERROR',
            'Proactive token refresh failed',
            'AdminPage',
            error instanceof Error ? error : undefined
          )
        }
      }
      void runRefresh()
    }, 60000)

    return (): void => clearInterval(interval)
  }, [isReady, addLog])
}

// Recovery removed

export default function AdminPage(): JSX.Element {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'playlist'
    | 'settings'
    | 'logs'
    | 'analytics'
    | 'branding'
    | 'subscription'
  >('dashboard')

  const initializationAttemptedRef = useRef(false)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const username = params?.username as string | undefined
  const { isReady, status: playerStatus, deviceId } = useSpotifyPlayerStore()

  // Set up navigation callback for player lifecycle
  const handleNavigate = useCallback(
    (path: string) => {
      router.push(path)
    },
    [router]
  )

  const { createPlayer } = useAdminSpotifyPlayerHook(handleNavigate)
  const { addLog } = useConsoleLogsContext()
  // Use the enhanced playlist hook with real-time subscriptions
  const {
    data: queue,
    isLoading: queueLoading,
    error: playlistError,
    mutate: refreshQueue,
    optimisticUpdate
  } = usePlaylistData(username)

  // Use the track suggestions hook (properly typed)
  const trackSuggestions = useTrackSuggestions()
  const updateTrackSuggestionsState = trackSuggestions.updateState

  // First, use the health monitor hook
  const healthStatus = useSpotifyHealthMonitor()

  // Recovery removed

  // Handle sign out with re-authentication
  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true)
    try {
      await startFreshAuthentication()
    } catch (error) {
      addLog(
        'ERROR',
        'Error signing out',
        'AdminPage',
        error instanceof Error ? error : undefined
      )
      setIsSigningOut(false)
    }
  }

  // Get premium status
  const { profile, loading: profileLoading } = useGetProfile()

  const { hasPremiumAccess, isLoading: subscriptionLoading } = useSubscription(
    profile?.id
  )

  // Determine if premium features should be disabled
  // Only disable if we're not loading AND the user doesn't have premium access
  const isPremiumDisabled =
    !subscriptionLoading && !profileLoading && !hasPremiumAccess

  // Extract token health from healthStatus to avoid duplicate API calls
  const tokenHealth = {
    status: healthStatus.token,
    expiringSoon: healthStatus.tokenExpiringSoon
  }

  // Update QueueManager with queue data
  useEffect(() => {
    if (queue) {
      queueManager.updateQueue(queue)
    }
  }, [queue])

  // Initialize AutoPlayService when username and deviceId are available
  useEffect(() => {
    if (!username || !deviceId || !isReady) {
      return
    }

    const autoPlayService = getAutoPlayService({
      username,
      deviceId,
      checkInterval: 500 // Reduced for predictive track start
    })

    // Set username and deviceId (in case service was already created)
    autoPlayService.setUsername(username)
    autoPlayService.setDeviceId(deviceId)

    // Start the service if not already running
    if (!autoPlayService.isActive()) {
      autoPlayService.start()
      autoPlayService.markAsInitialized()
    }

    // Update queue in AutoPlayService
    if (queue) {
      autoPlayService.updateQueue(queue)
    }

    // Set initial track suggestions state
    const trackSuggestionsState = trackSuggestions.state
    if (trackSuggestionsState) {
      autoPlayService.setTrackSuggestionsState(trackSuggestionsState)
    }

    return (): void => {
      // Don't stop the service on unmount - it should keep running
      // The service is a singleton and should persist across re-renders
    }
  }, [username, deviceId, isReady, queue, trackSuggestions.state, addLog])

  // Initialize the player when the component mounts
  useEffect(() => {
    const initializePlayer = async (): Promise<void> => {
      // Only initialize if not ready, SDK is available, we haven't attempted initialization yet
      if (
        playerStatus === 'initializing' &&
        typeof window !== 'undefined' &&
        window.Spotify &&
        !initializationAttemptedRef.current
      ) {
        try {
          initializationAttemptedRef.current = true
          await createPlayer()
        } catch (error: unknown) {
          addLog(
            'ERROR',
            'Failed to initialize Spotify player',
            'AdminPage',
            error instanceof Error ? error : undefined
          )
          // Reset the flag on error so we can retry
          initializationAttemptedRef.current = false
        }
      }
    }

    void initializePlayer()
  }, [playerStatus, addLog, createPlayer])

  // Add missing functions
  const handleTabChange = useCallback((value: string): void => {
    setActiveTab(
      value as
        | 'dashboard'
        | 'playlist'
        | 'settings'
        | 'logs'
        | 'analytics'
        | 'branding'
        | 'subscription'
    )
  }, [])

  const handleTrackSuggestionsStateChange = useCallback(
    (state: TrackSuggestionsState): void => {
      updateTrackSuggestionsState(state)
      // Pass state to AutoPlayService
      if (username) {
        const autoPlayService = getAutoPlayService()
        autoPlayService.setTrackSuggestionsState(state)
      }
    },
    [updateTrackSuggestionsState, username]
  )

  // Add graceful token error handling
  const handleTokenError = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)

      // Clear token cache
      tokenManager.clearCache()

      // Force token refresh
      await tokenManager.getToken()

      // Reinitialize player
      await createPlayer()

      setError(null)
    } catch (error: unknown) {
      addLog(
        'ERROR',
        'Automatic token refresh failed',
        'AdminPage',
        error instanceof Error ? error : undefined
      )
      setError('Token refresh failed. Please check your Spotify credentials.')
    } finally {
      setIsLoading(false)
    }
  }, [addLog, createPlayer])

  useAdminTokenManagement({
    tokenHealthStatus: tokenHealth.status,
    isLoading,
    isReady,
    handleTokenError,
    addLog
  })

  // Recovery removed

  if (playlistError) {
    return (
      <div className='p-4 text-red-500'>
        <p>Error loading queue: {playlistError ?? 'Unknown error'}</p>
      </div>
    )
  }

  if (queueLoading && (!queue || queue.length === 0)) {
    return (
      <div className='text-white min-h-screen bg-black p-4'>
        <div className='mx-auto max-w-xl space-y-4'>
          <div className='flex items-center justify-center p-8'>
            <Loading className='h-8 w-8' />
            <span className='ml-3 text-lg'>Loading admin page...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <AutoFillNotification />

      <div className='mx-auto max-w-xl space-y-4'>
        <h1 className='mb-8 text-2xl font-bold'>Admin Controls</h1>

        <Tabs
          value={activeTab}
          onValueChange={(value: string): void => {
            handleTabChange(value)
          }}
          className='space-y-4'
        >
          <TabsList className='grid w-full grid-cols-6 bg-gray-800/50'>
            <TabsTrigger
              value='dashboard'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value='playlist'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Playlist
            </TabsTrigger>
            <TabsTrigger
              value='settings'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Suggestions
            </TabsTrigger>
            <TabsTrigger
              value='analytics'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Analytics
            </TabsTrigger>
            <TabsTrigger
              value='branding'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Branding
            </TabsTrigger>
            <TabsTrigger
              value='subscription'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Subscription
            </TabsTrigger>
          </TabsList>

          <TabsContent value='dashboard'>
            {error && (
              <ErrorMessage
                message={error}
                onDismiss={() => setError(null)}
                className='mb-4'
              />
            )}

            <div className='mb-6 flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
              <div>
                <h3 className='text-lg font-semibold'>Account</h3>
                <p className='text-sm text-gray-400'>
                  Signed in as {profile?.display_name ?? username}
                </p>
              </div>
              <button
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
                className='text-white flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isSigningOut ? (
                  <Loading className='h-4 w-4' />
                ) : (
                  <ArrowRightOnRectangleIcon className='h-4 w-4' />
                )}
                {isSigningOut ? 'Signing Out...' : 'Sign Out & Re-authenticate'}
              </button>
            </div>

            <HealthStatusSection
              healthStatus={healthStatus}
              isReady={isReady}
              playerStatus={playerStatus}
            />

            <JukeboxSection className='mt-8' />
          </TabsContent>

          <TabsContent value='settings'>
            {isPremiumDisabled ? (
              <div className='space-y-4'>
                <PremiumNotice />
                <div className='pointer-events-none opacity-50'>
                  <TrackSuggestionsTab
                    onStateChange={handleTrackSuggestionsStateChange}
                    initialState={{ maxOffset: 10 }}
                  />
                </div>
              </div>
            ) : (
              <TrackSuggestionsTab
                onStateChange={handleTrackSuggestionsStateChange}
                initialState={{ maxOffset: 10 }}
              />
            )}
          </TabsContent>

          <TabsContent value='playlist'>
            <PlaylistDisplay
              queue={queue ?? []}
              onQueueChanged={async (): Promise<void> => {
                await refreshQueue()
              }}
              optimisticUpdate={optimisticUpdate}
              username={username}
            />
          </TabsContent>

          <TabsContent value='analytics'>
            {isPremiumDisabled ? (
              <div className='space-y-4'>
                <PremiumNotice />
                <div className='pointer-events-none opacity-50'>
                  <AnalyticsTab username={username} />
                </div>
              </div>
            ) : (
              <AnalyticsTab username={username} />
            )}
          </TabsContent>

          <TabsContent value='branding'>
            {isPremiumDisabled ? (
              <div className='space-y-4'>
                <PremiumNotice />
                <div className='pointer-events-none opacity-50'>
                  <BrandingTab />
                </div>
              </div>
            ) : (
              <BrandingTab />
            )}
          </TabsContent>

          <TabsContent value='subscription'>
            <SubscriptionTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
