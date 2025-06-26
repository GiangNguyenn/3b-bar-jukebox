/* eslint-disable @typescript-eslint/no-unsafe-assignment */
'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import {
  useSpotifyPlayerStore,
  useAdminSpotifyPlayerHook
} from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useTrackSuggestions } from './components/track-suggestions/hooks/useTrackSuggestions'
import { useSpotifyHealthMonitor } from '@/hooks/useSpotifyHealthMonitor'
import { useAutoPlaylistRefresh } from '@/hooks/useAutoPlaylistRefresh'
import { SpotifyApiService } from '@/services/spotifyApi'
import { RecoveryStatus } from '@/components/ui/recovery-status'
import { HealthStatusSection } from './components/dashboard/health-status-section'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type PlaybackInfo } from '@/shared/types/health'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import { useRecoverySystem } from '@/hooks/recovery'
import { ErrorMessage } from '@/components/ui/error-message'
import { Loading, PlaylistSkeleton } from '@/components/ui'
import { useTokenHealth } from '@/hooks/health/useTokenHealth'
import { tokenManager } from '@/shared/token/tokenManager'

export default function AdminPage(): JSX.Element {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'playlist' | 'settings' | 'logs'
  >('dashboard')
  const initializationAttemptedRef = useRef(false)

  // Hooks
  const {
    deviceId,
    isReady,
    playbackState,
    status: playerStatus
  } = useSpotifyPlayerStore()
  const { createPlayer } = useAdminSpotifyPlayerHook()
  const {
    fixedPlaylistId,
    isLoading: isFixedPlaylistLoading,
    error: fixedPlaylistError
  } = useFixedPlaylist()
  const { addLog } = useConsoleLogsContext()

  // Use the playlist hook
  const playlistHookResult = usePlaylist(fixedPlaylistId ?? '')
  const playlistRefreshError = playlistHookResult.error
  const refreshPlaylist = playlistHookResult.refreshPlaylist

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
    fixedPlaylistId,
    undefined // No callback needed for admin page
  )

  // Add token health monitoring
  const tokenHealth = useTokenHealth()

  // Enable automatic playlist refresh every 3 minutes
  useAutoPlaylistRefresh({
    isEnabled: isReady && !!fixedPlaylistId,
    trackSuggestionsState,
    refreshPlaylist
  })

  // Create a more reliable playback state indicator
  const getIsActuallyPlaying = useCallback(() => {
    if (!playbackState) return false

    // If the SDK says it's not playing, it's not playing
    if (!playbackState.is_playing) return false

    // If we have a track and it's supposed to be playing, trust the SDK state
    return true
  }, [playbackState])

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

  const handlePlayPause = useCallback(async (): Promise<void> => {
    if (!deviceId) return

    try {
      setIsLoading(true)
      const spotifyApi = SpotifyApiService.getInstance()

      if (getIsActuallyPlaying()) {
        // If currently playing, pause playback
        const result = await spotifyApi.pausePlayback(deviceId)
        if (result.success) {
          setPlaybackInfo((prev: PlaybackInfo | null) =>
            prev
              ? {
                  ...prev,
                  isPlaying: false
                }
              : null
          )
        } else {
          throw new Error('Failed to pause playback')
        }
      } else {
        // If not playing, resume playback
        const result = await spotifyApi.resumePlayback()
        if (result.success) {
          setPlaybackInfo((prev: PlaybackInfo | null) =>
            prev
              ? {
                  ...prev,
                  isPlaying: true,
                  lastProgressCheck: Date.now(),
                  progressStalled: false
                }
              : null
          )
        } else {
          throw new Error('Failed to resume playback')
        }
      }

      // Add a small delay to allow the Spotify API to update
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Refresh the playback state
      const state = await spotifyApi.getPlaybackState()
      if (state) {
        setPlaybackInfo((prev: PlaybackInfo | null) =>
          prev
            ? {
                ...prev,
                isPlaying: state.is_playing,
                currentTrack: state.item?.name ?? '',
                progress: state.progress_ms ?? 0,
                duration_ms: state.item?.duration_ms ?? 0,
                timeUntilEnd:
                  state.item?.duration_ms && state.progress_ms
                    ? state.item.duration_ms - state.progress_ms
                    : 0,
                lastProgressCheck: Date.now(),
                progressStalled: false
              }
            : null
        )
      }
    } catch (error) {
      addLog(
        'ERROR',
        'Playback control failed',
        'Playback',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsLoading(false)
    }
  }, [deviceId, getIsActuallyPlaying, addLog])

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
      addLog('INFO', 'Refreshing playlist...', 'AdminPage')
      await refreshPlaylist(trackSuggestionsState)
      addLog('INFO', 'Playlist refreshed successfully', 'AdminPage')
    } catch (error) {
      addLog(
        'ERROR',
        'Failed to refresh playlist',
        'AdminPage',
        error instanceof Error ? error : undefined
      )
      setError(
        error instanceof Error ? error.message : 'Failed to refresh playlist'
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [refreshPlaylist, trackSuggestionsState, addLog])

  // Add missing functions
  const handleTabChange = useCallback((value: string): void => {
    setActiveTab(value as 'dashboard' | 'playlist' | 'settings' | 'logs')
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
      void (async () => {
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

    return () => clearInterval(interval)
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

  // Update error handling
  if (fixedPlaylistError) {
    return (
      <div className='p-4 text-red-500'>
        <p>
          Error loading playlist:{' '}
          {fixedPlaylistError instanceof Error
            ? fixedPlaylistError.message
            : String(fixedPlaylistError)}
        </p>
      </div>
    )
  }

  if (isFixedPlaylistLoading) {
    return <PlaylistSkeleton />
  }

  if (playlistRefreshError) {
    return (
      <div className='p-4 text-red-500'>
        <p>
          Error refreshing playlist:{' '}
          {playlistRefreshError instanceof Error
            ? playlistRefreshError.message
            : String(playlistRefreshError)}
        </p>
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
          <TabsList className='grid w-full grid-cols-3 bg-gray-800/50'>
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
              playbackInfo={playbackInfo}
              formatTime={formatTime}
              isReady={isReady}
            />

            <div className='mt-8 space-y-4'>
              <h2 className='text-xl font-semibold'>Controls</h2>
              <div className='flex gap-4'>
                <button
                  onClick={() => void handlePlayPause()}
                  disabled={!isReady || isLoading || recoveryState.isRecovering}
                  className={`text-white flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    getIsActuallyPlaying()
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isLoading ? (
                    <div className='flex items-center justify-center gap-2'>
                      <Loading className='h-4 w-4' />
                      <span>Loading...</span>
                    </div>
                  ) : !isReady ? (
                    'Initializing...'
                  ) : recoveryState.isRecovering ? (
                    'Recovering...'
                  ) : getIsActuallyPlaying() ? (
                    'Pause'
                  ) : (
                    'Play'
                  )}
                </button>
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
            <PlaylistDisplay playlistId={fixedPlaylistId ?? ''} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
