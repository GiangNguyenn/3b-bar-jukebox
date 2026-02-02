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
import { DiagnosticPanel } from './components/dashboard/components/diagnostic-panel'
import { JukeboxSection } from './components/dashboard/components/jukebox-section'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import { AnalyticsTab } from './components/analytics/analytics-tab'
import { BrandingTab } from './components/branding/branding-tab'
// PremiumNotice removed to fix lint
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading } from '@/components/ui'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'
import { getAutoPlayService } from '@/services/autoPlayService'

import { useGetProfile } from '@/hooks/useGetProfile'
import { startFreshAuthentication } from '@/shared/utils/authCleanup'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'
import { Copy, Check, QrCode } from 'lucide-react'
import { QRCodeComponent } from '@/components/ui'

// Autoplay helper removed

import { useAdminTokenManagement } from '@/hooks/useAdminTokenManagement'
import { usePlaybackEnforcer } from '@/hooks/usePlaybackEnforcer'

// Recovery removed

export default function AdminPage(): JSX.Element {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'playlist' | 'settings' | 'logs' | 'analytics' | 'branding'
  >('dashboard')
  const [copied, setCopied] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)

  const initializationAttemptedRef = useRef(false)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const username = params?.username as string | undefined
  const { isReady, status: playerStatus, deviceId } = useSpotifyPlayerStore()

  const openAdminPath = (path: string): void => {
    if (!username) return
    window.open(`/${username}/${path}`, '_blank')
  }

  const handleCopyLink = async (): Promise<void> => {
    if (username) {
      const jukeboxUrl = `${window.location.origin}/${username}/playlist`
      try {
        await navigator.clipboard.writeText(jukeboxUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (error) {
        addLog(
          'ERROR',
          'Failed to copy link to clipboard',
          'AdminPage',
          error instanceof Error ? error : undefined
        )
      }
    }
  }

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
    isStale: queueIsStale,
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
  const { profile } = useGetProfile()

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

    // Set logger for diagnostics
    autoPlayService.setLogger(addLog)

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

  // Monitor connection status and trigger auto-fill on reconnection
  useEffect(() => {
    if (healthStatus.connection === 'connected' && username) {
      const autoPlayService = getAutoPlayService()
      if (autoPlayService.isActive()) {
        // Trigger immediate check when connection is restored
        // This minimizes downtime after a disconnection
        addLog(
          'INFO',
          'Connection restored - triggering auto-fill check',
          'AdminPage'
        )

        // Use type assertion to access private/protected method if needed,
        // or rely on the fact that we can call public methods that trigger it.
        // updateQueue triggers a check, so we can pass the current queue.
        if (queue) {
          autoPlayService.updateQueue(queue)
        }
      }
    }
  }, [healthStatus.connection, username, queue, addLog])

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

      // Force token refresh (this will use recovery logic in API endpoints)
      const token = await tokenManager.getToken()

      if (!token) {
        throw new Error('Failed to obtain token after refresh')
      }

      // Reinitialize player
      await createPlayer()

      setError(null)
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      // Determine if this is a recoverable error
      const needsUserAction =
        errorMessage.includes('INVALID_REFRESH_TOKEN') ||
        errorMessage.includes('INVALID_CLIENT_CREDENTIALS') ||
        errorMessage.includes('NO_REFRESH_TOKEN') ||
        errorMessage.includes('NOT_AUTHENTICATED')

      addLog(
        'ERROR',
        `Automatic token refresh failed: ${errorMessage}`,
        'AdminPage',
        error instanceof Error ? error : undefined
      )

      if (needsUserAction) {
        setError('Please reconnect your Spotify account to continue playback.')
      } else {
        // For recoverable errors, show a more helpful message
        setError(
          'Temporary issue refreshing token. The system will retry automatically.'
        )
      }
    } finally {
      setIsLoading(false)
    }
  }, [addLog, createPlayer])

  useAdminTokenManagement({
    tokenHealthStatus: tokenHealth.status,
    isLoading,
    isReady,
    playerStatus,
    handleTokenError,
    addLog
  })

  // Recovery removed

  // Enforce single-device playback
  usePlaybackEnforcer(true) // Always enabled when admin page is loaded

  // Only show loading if we have no queue data at all
  if (queueLoading && (!queue || queue.length === 0) && !playlistError) {
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

      {/* Queue Error Warning Banner */}
      {playlistError && (
        <div className='mx-auto mb-4 max-w-xl rounded-lg border border-yellow-600 bg-yellow-900/50 p-4'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex-1'>
              <h3 className='mb-1 font-semibold text-yellow-200'>
                Queue Sync Issue
              </h3>
              <p className='mb-2 text-sm text-yellow-100'>{playlistError}</p>
              {queueIsStale && queue.length > 0 && (
                <p className='text-xs text-yellow-200'>
                  Using cached queue data ({queue.length} tracks). Playback will
                  continue normally.
                </p>
              )}
            </div>
            <button
              onClick={() => {
                void refreshQueue()
              }}
              className='text-white whitespace-nowrap rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-yellow-700'
            >
              Retry
            </button>
          </div>
        </div>
      )}

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
          </TabsList>

          <TabsContent value='dashboard'>
            {error && (
              <ErrorMessage
                message={error}
                onDismiss={() => setError(null)}
                className='mb-4'
              />
            )}

            <JukeboxSection />

            <div className='mb-6 space-y-3 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
              <h3 className='text-white text-lg font-semibold'>Launch Views</h3>
              <p className='text-sm text-gray-400'>
                Quickly open the game, display, or jukebox in new tabs.
              </p>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <button
                  type='button'
                  onClick={() => openAdminPath('game')}
                  disabled={!username}
                  className='text-white w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  Open Game
                </button>
                <button
                  type='button'
                  onClick={() => openAdminPath('display')}
                  disabled={!username}
                  className='text-white w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  Open Display
                </button>
                <button
                  type='button'
                  onClick={() => openAdminPath('playlist')}
                  disabled={!username}
                  className='text-white w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  Open Jukebox
                </button>
              </div>

              {/* Public Jukebox Link with QR Code */}
              {username && (
                <div className='mt-4 space-y-2 border-t border-gray-700 pt-4'>
                  <div className='flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2'>
                    <span className='flex-1 truncate text-sm text-gray-300'>
                      {`${window.location.origin}/${username}/playlist`}
                    </span>
                    <div className='flex items-center gap-1'>
                      <button
                        type='button'
                        onClick={(): void => {
                          setShowQRCode(!showQRCode)
                        }}
                        className='hover:text-white flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-700'
                        title='Show/hide QR code'
                      >
                        <QrCode className='h-4 w-4' />
                      </button>
                      <button
                        type='button'
                        onClick={(): void => {
                          void handleCopyLink()
                        }}
                        className='hover:text-white flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-700'
                        title='Copy link to clipboard'
                      >
                        {copied ? (
                          <Check className='h-4 w-4 text-green-500' />
                        ) : (
                          <Copy className='h-4 w-4' />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className='text-center text-xs text-gray-400'>
                    {copied
                      ? 'Link copied!'
                      : 'Public jukebox page - share with guests (no Spotify account required)'}
                  </p>

                  {/* QR Code Section */}
                  {showQRCode && (
                    <div className='mt-4 rounded-lg border border-gray-700 bg-gray-800/50 p-4'>
                      <div className='mb-3 text-center'>
                        <h4 className='text-white text-sm font-medium'>
                          QR Code
                        </h4>
                        <p className='text-xs text-gray-400'>
                          Scan to open the jukebox page
                        </p>
                      </div>
                      <QRCodeComponent
                        url={`${window.location.origin}/${username}/playlist`}
                        size={180}
                        className='mx-auto'
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

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

            <DiagnosticPanel
              healthStatus={healthStatus}
              isReady={isReady}
              playerStatus={playerStatus}
              className='mt-8'
            />
          </TabsContent>

          <TabsContent value='settings'>
            <TrackSuggestionsTab
              onStateChange={handleTrackSuggestionsStateChange}
              initialState={{ maxOffset: 10 }}
            />
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
            <AnalyticsTab username={username} />
          </TabsContent>

          <TabsContent value='branding'>
            <BrandingTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
