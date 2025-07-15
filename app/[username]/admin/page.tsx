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
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import { AnalyticsTab } from './components/analytics/analytics-tab'
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

export default function AdminPage(): JSX.Element {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'playlist' | 'settings' | 'logs' | 'analytics'
  >('dashboard')
  const initializationAttemptedRef = useRef(false)

  // Hooks
  const params = useParams()
  const username = params?.username as string | undefined
  const {
    deviceId,
    isReady,
    playbackState,
    status: playerStatus
  } = useSpotifyPlayerStore()
  const { createPlayer } = useAdminSpotifyPlayerHook()
  const { addLog } = useConsoleLogsContext()
  const { userIntent, setUserIntent } = usePlaybackIntentStore()
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

  // First, use the health monitor hook
  const healthStatus = useSpotifyHealthMonitor()

  // Get recovery system for manual recovery
  const { state: recoveryState, recover } = useRecoverySystem(
    deviceId,
    null // No playlist ID needed for admin page
  )

  // Add token health monitoring
  const tokenHealth = useTokenHealth()

  // Initialize auto-play service
  useEffect(() => {
    const autoPlayService = getAutoPlayService({
      checkInterval: 2000, // Check every 2 seconds
      deviceId: deviceId ?? null,
      username: username ?? null,
      onTrackFinished: (trackId: string) => {
        addLog('INFO', `Auto-play: Track finished - ${trackId}`, 'AdminPage')
        // Refresh queue when track finishes to update the UI
        void refreshQueue()
      },
      onNextTrackStarted: (track) => {
        addLog(
          'INFO',
          `Auto-play: Started playing - ${track.tracks.name}`,
          'AdminPage'
        )
        setUserIntent('playing')
        // Refresh queue when next track starts to update the UI
        void refreshQueue()
      },
      onQueueEmpty: () => {
        addLog(
          'INFO',
          'Auto-play: Queue is empty, stopping playback',
          'AdminPage'
        )
        setUserIntent('paused')
      },
      onQueueLow: () => {
        addLog('INFO', 'Auto-play: Queue is low, auto-filling...', 'AdminPage')
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

    return (): void => {
      autoPlayService.stop()
    }
  }, [deviceId, username, queue, addLog, setUserIntent, refreshQueue])

  // Update QueueManager with queue data
  useEffect(() => {
    if (queue) {
      queueManager.updateQueue(queue)
    }
  }, [queue])

  // Initialize the player when the component mounts
  useEffect(() => {
    const initializePlayer = async (): Promise<void> => {
      // Only initialize if not ready, SDK is available, and we haven't attempted initialization yet
      if (
        playerStatus === 'initializing' &&
        typeof window !== 'undefined' &&
        window.Spotify &&
        !initializationAttemptedRef.current
      ) {
        try {
          initializationAttemptedRef.current = true
          addLog(
            'INFO',
            `Initializing Spotify player... (status: ${playerStatus})`,
            'AdminPage'
          )
          await createPlayer()
          addLog('INFO', 'Spotify player initialization completed', 'AdminPage')
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
      } else {
        addLog(
          'INFO',
          `Skipping player initialization - status: ${playerStatus}, SDK available: ${typeof window !== 'undefined' && !!window.Spotify}, already attempted: ${initializationAttemptedRef.current}`,
          'AdminPage'
        )
      }
    }

    void initializePlayer()
  }, [playerStatus, addLog, createPlayer])

  // Manual recovery trigger for user-initiated recovery (e.g., device mismatch, connection issues)
  const handleForceRecovery = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      addLog('INFO', 'Manual recovery triggered by user', 'AdminPage')

      // Trigger the recovery system
      await recover()

      addLog('INFO', 'Manual recovery completed', 'AdminPage')
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

  // Create a wrapper for the force recovery handler
  const handleForceRecoveryClick = useCallback((): void => {
    void handleForceRecovery()
  }, [handleForceRecovery])

  // Handle refresh playlist with loading state
  const handleRefreshPlaylist = useCallback(async (): Promise<void> => {
    try {
      setIsRefreshing(true)
      addLog('INFO', 'Auto-filling queue...', 'AdminPage')

      if (!username) {
        throw new Error('Username is not set.')
      }

      // This is a simplified logic for auto-queue filling.
      // In a real scenario, this would call the track suggestions API
      // and then add those tracks to the queue.
      addLog('INFO', 'Track Suggestions State being sent:', 'AdminPage')
      const response = await fetch('/api/track-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trackSuggestionsState)
      })

      if (!response.ok) {
        const errorBody = await response.json()
        addLog(
          'ERROR',
          `Track Suggestions API error: ${JSON.stringify(errorBody)}`,
          'AdminPage'
        )
        throw new Error('Failed to get track suggestions for auto-fill.')
      }

      const suggestions = (await response.json()) as {
        tracks: { id: string }[]
      }

      for (const track of suggestions.tracks) {
        // Fetch full track details from Spotify
        const trackDetails = await sendApiRequest<{
          id: string
          name: string
          artists: Array<{ name: string }>
          album: { name: string }
          duration_ms: number
          popularity: number
          uri: string
        }>({
          path: `tracks/${track.id}`,
          method: 'GET'
        })

        addLog(
          'INFO',
          `Track details from Spotify: ${JSON.stringify(trackDetails)}`,
          'AdminPage'
        )

        addLog(
          'INFO',
          `Track details structure: ${JSON.stringify({
            id: trackDetails.id,
            name: trackDetails.name,
            artists: trackDetails.artists,
            album: trackDetails.album,
            duration_ms: trackDetails.duration_ms,
            popularity: trackDetails.popularity,
            uri: trackDetails.uri
          })}`,
          'AdminPage'
        )

        await fetch(`/api/playlist/${username}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracks: trackDetails,
            initialVotes: 1 // Auto-fill tracks get 1 vote
          })
        })
      }

      addLog('INFO', 'Queue auto-fill completed successfully', 'AdminPage')
      await refreshQueue()
    } catch (error) {
      addLog(
        'ERROR',
        'Failed to auto-fill queue',
        'AdminPage',
        error instanceof Error ? error : undefined
      )
      setError(
        error instanceof Error ? error.message : 'Failed to auto-fill queue'
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [trackSuggestionsState, addLog, refreshQueue, username])

  // Add missing functions
  const handleTabChange = useCallback((value: string): void => {
    setActiveTab(
      value as 'dashboard' | 'playlist' | 'settings' | 'logs' | 'analytics'
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
      addLog('INFO', 'Attempting automatic token recovery', 'AdminPage')

      // Clear token cache
      tokenManager.clearCache()

      // Force token refresh
      await tokenManager.getToken()

      // Reinitialize player
      await createPlayer()

      addLog('INFO', 'Automatic token recovery successful', 'AdminPage')
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
      addLog(
        'INFO',
        'Token health error detected, triggering automatic recovery',
        'AdminPage'
      )
      void handleTokenError()
    }
  }, [tokenHealth.status, isLoading, isReady, handleTokenError, addLog])

  // Proactive token refresh interval - check every minute
  useEffect(() => {
    if (!isReady) return

    const interval = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const wasRefreshed = await tokenManager.refreshIfNeeded()
          if (wasRefreshed) {
            addLog('INFO', 'Proactive token refresh completed', 'AdminPage')
          }
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

  useEffect(() => {
    addLog(
      'INFO',
      `AdminPage render: playbackState=${JSON.stringify(playbackState)}, healthStatus.playback=${healthStatus.playback}`,
      'AdminPage'
    )
  }, [playbackState, healthStatus.playback, addLog])

  // Automatically trigger recovery if playback stalls
  useEffect(() => {
    if (healthStatus.playback === 'stalled' && !recoveryState.isRecovering) {
      addLog(
        'INFO',
        'Playback stall detected, triggering automatic recovery.',
        'AdminPage'
      )
      void recover()
    }
  }, [healthStatus.playback, recoveryState.isRecovering, recover, addLog])

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
      <div className='p-4 text-gray-400'>
        <p>Loading queue...</p>
      </div>
    )
  }

  return (
    <div className='text-white min-h-screen bg-black p-4'>
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
          <TabsList className='grid w-full grid-cols-4 bg-gray-800/50'>
            <TabsTrigger
              value='dashboard'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value='settings'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Track Suggestions
            </TabsTrigger>
            <TabsTrigger
              value='playlist'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Playlist
            </TabsTrigger>
            <TabsTrigger
              value='analytics'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Analytics
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

            <div className='mt-8 space-y-4'>
              <h2 className='text-xl font-semibold'>Controls</h2>

              {/* Play/Pause Button - QueueManager Integration */}
              <div className='mb-4 flex justify-center'>
                <button
                  onClick={() => {
                    void (async (): Promise<void> => {
                      try {
                        if (userIntent === 'playing') {
                          // Pause playback
                          setUserIntent('paused')
                          await sendApiRequest({
                            path: `me/player/pause?device_id=${deviceId}`,
                            method: 'PUT'
                          })
                          addLog(
                            'INFO',
                            'Playback paused via QueueManager system',
                            'AdminPage'
                          )
                        } else {
                          // Resume playback - use QueueManager to get next track
                          const nextTrack = queueManager.getNextTrack()

                          if (nextTrack) {
                            // Play the next track from the queue
                            const trackUri = `spotify:track:${nextTrack.tracks.spotify_track_id}`
                            await sendApiRequest({
                              path: `me/player/play?device_id=${deviceId}`,
                              method: 'PUT',
                              body: {
                                uris: [trackUri]
                              }
                            })
                            setUserIntent('playing')
                            addLog(
                              'INFO',
                              `Playing next track from queue: ${nextTrack.tracks.name}`,
                              'AdminPage'
                            )
                          } else {
                            // No tracks in queue, try to resume current playback
                            await sendApiRequest({
                              path: `me/player/play?device_id=${deviceId}`,
                              method: 'PUT'
                            })
                            setUserIntent('playing')
                            addLog(
                              'INFO',
                              'Resuming playback (no queue tracks available)',
                              'AdminPage'
                            )
                          }
                        }
                      } catch (error) {
                        addLog(
                          'ERROR',
                          'Playback control failed via QueueManager system',
                          'AdminPage',
                          error as Error
                        )
                      }
                    })()
                  }}
                  disabled={!isReady || recoveryState.isRecovering}
                  className='text-white max-w-xs flex-1 rounded-lg bg-green-600 px-6 py-3 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {userIntent === 'playing' ? 'Pause' : 'Play'}
                </button>
              </div>

              <div className='flex gap-4'>
                <button
                  onClick={() => void handleRefreshPlaylist()}
                  disabled={
                    !isReady ||
                    isRefreshing ||
                    isLoading ||
                    recoveryState.isRecovering
                  }
                  className='text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isRefreshing || isLoading ? (
                    <div className='flex items-center justify-center gap-2'>
                      <Loading className='h-4 w-4' />
                      <span>
                        {isRefreshing ? 'Refreshing...' : 'Loading...'}
                      </span>
                    </div>
                  ) : !isReady ? (
                    'Initializing...'
                  ) : recoveryState.isRecovering ? (
                    'Recovering...'
                  ) : (
                    'Refresh Playlist'
                  )}
                </button>
                <button
                  onClick={handleForceRecoveryClick}
                  disabled={isLoading}
                  className='text-white flex-1 rounded-lg bg-orange-600 px-4 py-2 font-medium transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? (
                    <div className='flex items-center justify-center gap-2'>
                      <Loading className='h-4 w-4' />
                      <span>Loading...</span>
                    </div>
                  ) : recoveryState.isRecovering ? (
                    'Recovering...'
                  ) : (
                    'Manual Recovery'
                  )}
                </button>
              </div>
            </div>
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
              onQueueChanged={async () => {
                await refreshQueue()
              }}
              optimisticUpdate={optimisticUpdate}
            />
          </TabsContent>

          <TabsContent value='analytics'>
            <AnalyticsTab username={username} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
