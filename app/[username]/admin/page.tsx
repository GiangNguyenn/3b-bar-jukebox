/* eslint-disable @typescript-eslint/no-unsafe-assignment */
'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { usePlaybackIntentStore } from '@/hooks/usePlaybackIntent'
import {
  useSpotifyPlayerStore,
  useAdminSpotifyPlayerHook
} from '@/hooks/useSpotifyPlayer'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import { useTrackSuggestions } from './components/track-suggestions/hooks/useTrackSuggestions'
import { useSpotifyHealthMonitor } from '@/hooks/useSpotifyHealthMonitor'
import { RecoveryStatus } from '@/components/ui/recovery-status'
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
import { useRecoverySystem } from '@/hooks/recovery'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui'
import { useTokenHealth } from '@/hooks/health/useTokenHealth'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'
import { getAutoPlayService } from '@/services/autoPlayService'
import { sendApiRequest } from '@/shared/api'
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'

import { useSubscription } from '@/hooks/useSubscription'
import { useGetProfile } from '@/hooks/useGetProfile'
import {
  FALLBACK_GENRES,
  DEFAULT_YEAR_RANGE,
  MIN_TRACK_POPULARITY,
  DEFAULT_MAX_SONG_LENGTH_MINUTES,
  DEFAULT_SONGS_BETWEEN_REPEATS,
  DEFAULT_MAX_OFFSET
} from '@/shared/constants/trackSuggestion'

export default function AdminPage(): JSX.Element {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const username = params?.username as string | undefined
  const { deviceId, isReady, status: playerStatus } = useSpotifyPlayerStore()
  const { createPlayer } = useAdminSpotifyPlayerHook()
  const { addLog } = useConsoleLogsContext()
  const { setUserIntent } = usePlaybackIntentStore()
  // Use the enhanced playlist hook with real-time subscriptions
  const {
    data: queue,
    isLoading: queueLoading,
    error: playlistError,
    mutate: refreshQueue,
    optimisticUpdate
  } = usePlaylistData(username)

  // Use the track suggestions hook
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const trackSuggestions = useTrackSuggestions()
  const trackSuggestionsState = trackSuggestions.state
  const updateTrackSuggestionsState = trackSuggestions.updateState

  // Debug track suggestions state
  useEffect(() => {
    addLog(
      'INFO',
      `[AdminPage] Track suggestions state updated: ${JSON.stringify(trackSuggestionsState)}`,
      'AdminPage'
    )
  }, [trackSuggestionsState, addLog])

  // First, use the health monitor hook
  const healthStatus = useSpotifyHealthMonitor()

  // Get recovery system for manual recovery
  const { state: recoveryState, recover } = useRecoverySystem(
    deviceId,
    null // No playlist ID needed for admin page
  )

  // Get premium status
  const { profile, loading: profileLoading } = useGetProfile()

  const { hasPremiumAccess, isLoading: subscriptionLoading } = useSubscription(
    profile?.id
  )

  // Determine if premium features should be disabled
  // Only disable if we're not loading AND the user doesn't have premium access
  const isPremiumDisabled =
    !subscriptionLoading && !profileLoading && !hasPremiumAccess

  // Add token health monitoring
  const tokenHealth = useTokenHealth()

  // Initialize auto-play service
  useEffect(() => {
    const autoPlayService = getAutoPlayService({
      checkInterval: 2000, // Check every 2 seconds
      deviceId: deviceId ?? null,
      username: username ?? null,
      onTrackFinished: () => {
        // Refresh queue when track finishes to update the UI
        void refreshQueue()
      },
      onNextTrackStarted: () => {
        setUserIntent('playing')
        // Refresh queue when next track starts to update the UI
        void refreshQueue()
      },
      onQueueEmpty: () => {
        setUserIntent('paused')
      },
      onQueueLow: () => {
        // Auto-fill will be handled by the service
      }
    })

    // Start the auto-play service
    autoPlayService.start()

    // Update the service when device ID changes
    if (deviceId) {
      autoPlayService.setDeviceId(deviceId)
    }

    // Update the service when username changes
    if (username) {
      autoPlayService.setUsername(username)
    }

    // Update the service when queue changes
    if (queue) {
      autoPlayService.updateQueue(queue)
    }

    // Update the service when track suggestions state changes
    if (trackSuggestionsState) {
      // Check if track suggestions state has all required fields
      const requiredFields = [
        'genres',
        'yearRange',
        'popularity',
        'allowExplicit',
        'maxSongLength',
        'songsBetweenRepeats',
        'maxOffset',
        'autoFillTargetSize'
      ]
      const hasAllFields = requiredFields.every(
        (field) => field in trackSuggestionsState
      )

      if (hasAllFields) {
        autoPlayService.setTrackSuggestionsState(trackSuggestionsState)
        addLog(
          'INFO',
          `[AdminPage] Updated auto-play service with complete track suggestions state: ${JSON.stringify(trackSuggestionsState)}`,
          'AdminPage'
        )
      } else {
        addLog(
          'WARN',
          `[AdminPage] Track suggestions state incomplete, not updating auto-play service. Missing: ${requiredFields.filter((field) => !(field in trackSuggestionsState)).join(', ')}`,
          'AdminPage'
        )
      }
    }

    // Mark the service as initialized after all initial setup is complete
    if (username && deviceId) {
      // Check if track suggestions state is available and complete
      if (trackSuggestionsState) {
        const requiredFields = [
          'genres',
          'yearRange',
          'popularity',
          'allowExplicit',
          'maxSongLength',
          'songsBetweenRepeats',
          'maxOffset',
          'autoFillTargetSize'
        ]
        const hasAllFields = requiredFields.every(
          (field) => field in trackSuggestionsState
        )

        if (hasAllFields) {
          autoPlayService.markAsInitialized()
          addLog(
            'INFO',
            `[AdminPage] Auto-play service initialized with complete track suggestions state`,
            'AdminPage'
          )
        } else {
          addLog(
            'WARN',
            `[AdminPage] Auto-play service not initialized - track suggestions state missing fields: ${requiredFields.filter((field) => !(field in trackSuggestionsState)).join(', ')}`,
            'AdminPage'
          )
        }
      } else {
        // Initialize without track suggestions state (will use fallbacks)
        autoPlayService.markAsInitialized()
        addLog(
          'INFO',
          `[AdminPage] Auto-play service initialized without track suggestions state (will use fallbacks)`,
          'AdminPage'
        )
      }
    } else {
      addLog(
        'WARN',
        `[AdminPage] Auto-play service not initialized - missing: username=${!!username}, deviceId=${!!deviceId}`,
        'AdminPage'
      )
    }

    return (): void => {
      autoPlayService.stop()
    }
  }, [
    deviceId,
    username,
    queue,
    trackSuggestionsState,
    addLog,
    setUserIntent,
    refreshQueue
  ])

  // Update QueueManager with queue data
  useEffect(() => {
    if (queue) {
      queueManager.updateQueue(queue)
    }
  }, [queue])

  // Initialize the player when the component mounts
  useEffect(() => {
    const initializePlayer = async (): Promise<void> => {
      // Only initialize if not ready, SDK is available, we haven't attempted initialization yet,
      // and recovery is not in progress
      if (
        playerStatus === 'initializing' &&
        typeof window !== 'undefined' &&
        window.Spotify &&
        !initializationAttemptedRef.current &&
        !recoveryState.isRecovering
      ) {
        try {
          initializationAttemptedRef.current = true
          await createPlayer()
        } catch (error) {
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
  }, [playerStatus, addLog, createPlayer, recoveryState.isRecovering])

  // Manual recovery trigger for user-initiated recovery (e.g., device mismatch, connection issues)
  const handleForceRecovery = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)

      // Trigger the recovery system
      await recover()
    } catch (error) {
      addLog(
        'ERROR',
        `Manual recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'AdminPage',
        error instanceof Error ? error : undefined
      )
      setError(
        error instanceof Error ? error.message : 'Manual recovery failed'
      )
    } finally {
      setIsLoading(false)
    }
  }, [recover, addLog])


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
    },
    [updateTrackSuggestionsState]
  )

  const formatTime = useCallback((ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }, [])

  // Add graceful token error recovery
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
    } catch (error) {
      addLog(
        'ERROR',
        'Automatic token recovery failed',
        'AdminPage',
        error instanceof Error ? error : undefined
      )
      setError('Token recovery failed. Please check your Spotify credentials.')
    } finally {
      setIsLoading(false)
    }
  }, [addLog, createPlayer])

  // Automatic token recovery when token health is in error state
  useEffect(() => {
    if (tokenHealth.status === 'error' && !isLoading && isReady) {
      void handleTokenError()
    }
  }, [tokenHealth.status, isLoading, isReady, handleTokenError])

  // Proactive token refresh interval - check every minute
  useEffect(() => {
    if (!isReady) return

    const interval = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          await tokenManager.refreshIfNeeded()
        } catch (error) {
          addLog(
            'ERROR',
            'Proactive token refresh failed',
            'AdminPage',
            error instanceof Error ? error : undefined
          )
        }
      })()
    }, 60000) // Check every minute

    return (): void => clearInterval(interval)
  }, [isReady, addLog])

  // Automatically trigger recovery if playback stalls
  useEffect(() => {
    if (healthStatus.playback === 'stalled' && !recoveryState.isRecovering) {
      void recover()
    }
  }, [healthStatus.playback, recoveryState.isRecovering, recover])

  if (playlistError) {
    return (
      <div className='p-4 text-red-500'>
        <p>
          Error loading queue:{' '}
          {typeof playlistError === 'string'
            ? playlistError
            : String(playlistError)}
        </p>
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
      <RecoveryStatus
        isRecovering={recoveryState.isRecovering}
        message={recoveryState.message}
        progress={recoveryState.progress}
        currentStep={recoveryState.currentStep}
      />

      <div className='mx-auto max-w-xl space-y-4'>
        <h1 className='mb-8 text-2xl font-bold'>Admin Controls</h1>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
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

            <HealthStatusSection
              healthStatus={healthStatus}
              playbackInfo={null}
              formatTime={formatTime}
              isReady={isReady}
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
              onQueueChanged={async () => {
                await refreshQueue()
              }}
              optimisticUpdate={optimisticUpdate}
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
