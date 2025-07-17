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
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'

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
  const { deviceId, isReady, status: playerStatus } = useSpotifyPlayerStore()
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
  }, [playerStatus, addLog, createPlayer])

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

  // Create a wrapper for the force recovery handler
  const handleForceRecoveryClick = useCallback((): void => {
    void handleForceRecovery()
  }, [handleForceRecovery])

  // Handle refresh playlist with loading state
  const handleRefreshPlaylist = useCallback(async (): Promise<void> => {
    try {
      setIsRefreshing(true)

      if (!username) {
        throw new Error('Username is not set.')
      }

      addLog(
        'INFO',
        `[AdminPage] Manual refresh - trackSuggestionsState: ${JSON.stringify(trackSuggestionsState)}`,
        'AdminPage'
      )

      // This is a simplified logic for auto-queue filling.
      // In a real scenario, this would call the track suggestions API
      // and then add those tracks to the queue.
      const response = await fetch('/api/track-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trackSuggestionsState)
      })

      addLog(
        'INFO',
        `[AdminPage] Track suggestions response status: ${response.status}`,
        'AdminPage'
      )

      if (!response.ok) {
        const errorBody = await response.json()
        addLog(
          'ERROR',
          `[AdminPage] Track Suggestions API error: ${JSON.stringify(errorBody)}`,
          'AdminPage'
        )

        // Try fallback to random track
        addLog(
          'INFO',
          `[AdminPage] Track suggestions failed, trying fallback to random track`,
          'AdminPage'
        )

        const fallbackResponse = await fetch('/api/random-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username })
        })

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.json()
          addLog(
            'ERROR',
            `[AdminPage] Random track API error: ${JSON.stringify(fallbackError)}`,
            'AdminPage'
          )
          throw new Error('Failed to get random track for fallback.')
        }

        const fallbackResult = (await fallbackResponse.json()) as {
          success: boolean
          track: {
            id: string
            spotify_track_id: string
            name: string
            artist: string
            album: string
            duration_ms: number
            popularity: number
            spotify_url: string
          }
        }

        if (fallbackResult.success && fallbackResult.track) {
          addLog(
            'INFO',
            `[AdminPage] Adding fallback track to queue: ${fallbackResult.track.name} by ${fallbackResult.track.artist}`,
            'AdminPage'
          )
          addLog(
            'INFO',
            `[AdminPage] Fallback track data: ${JSON.stringify(fallbackResult.track)}`,
            'AdminPage'
          )

          const playlistRequestBody = {
            tracks: {
              id: fallbackResult.track.spotify_track_id,
              name: fallbackResult.track.name,
              artists: [{ name: fallbackResult.track.artist }],
              album: { name: fallbackResult.track.album },
              duration_ms: fallbackResult.track.duration_ms,
              popularity: fallbackResult.track.popularity,
              uri: fallbackResult.track.spotify_url
            },
            initialVotes: 1,
            source: 'fallback'
          }

          addLog(
            'INFO',
            `[AdminPage] Playlist request body: ${JSON.stringify(playlistRequestBody)}`,
            'AdminPage'
          )

          const playlistResponse = await fetch(`/api/playlist/${username}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(playlistRequestBody)
          })

          if (!playlistResponse.ok) {
            const playlistError = await playlistResponse.json()
            addLog(
              'ERROR',
              `[AdminPage] Playlist API error: ${JSON.stringify(playlistError)}`,
              'AdminPage'
            )
          } else {
            addLog(
              'INFO',
              `[AdminPage] Successfully added fallback track to queue: ${fallbackResult.track.name}`,
              'AdminPage'
            )
          }
        } else {
          throw new Error('No random track available for fallback.')
        }
      } else {
        const suggestions = (await response.json()) as {
          tracks: { id: string }[]
        }

        addLog(
          'INFO',
          `[AdminPage] Track suggestions response: ${JSON.stringify(suggestions)}`,
          'AdminPage'
        )

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
            `[AdminPage] Adding track to queue: ${trackDetails.name} by ${trackDetails.artists[0].name}`,
            'AdminPage'
          )

          await fetch(`/api/playlist/${username}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracks: trackDetails,
              initialVotes: 1, // Auto-fill tracks get 1 vote
              source: 'admin' //Mark as admin-initiated
            })
          })
        }
      }

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
      <div className='p-4 text-gray-400'>
        <p>Loading queue...</p>
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
                          } else {
                            // No tracks in queue, try to resume current playback
                            await sendApiRequest({
                              path: `me/player/play?device_id=${deviceId}`,
                              method: 'PUT'
                            })
                            setUserIntent('playing')
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
