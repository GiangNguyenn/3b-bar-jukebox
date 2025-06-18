/* eslint-disable @typescript-eslint/no-unsafe-assignment */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSpotifyPlayerStore, useSpotifyPlayerHook } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useTrackSuggestions } from './components/track-suggestions/hooks/useTrackSuggestions'
import { useSpotifyHealthMonitor } from '@/hooks/useSpotifyHealthMonitor'
import { SpotifyApiService } from '@/services/spotifyApi'
import { RecoveryStatus } from '@/components/ui/recovery-status'
import { HealthStatusSection } from './components/dashboard/health-status-section'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { PlaylistDisplay } from './components/playlist/playlist-display'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type PlaybackInfo } from './components/dashboard/types'
import { type HealthStatus } from '@/shared/types'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

export default function AdminPage(): JSX.Element {
  // State
  const [isLoading, setIsLoading] = useState(false)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'playlist' | 'settings' | 'logs'
  >('dashboard')
  const [lastProgressCheck, setLastProgressCheck] = useState<number>(0)
  const [lastProgressMs, setLastProgressMs] = useState<number>(0)

  // Hooks
  const { deviceId, isReady, playbackState } = useSpotifyPlayerStore()
  const { createPlayer } = useSpotifyPlayerHook()
  const {
    fixedPlaylistId,
    isLoading: isFixedPlaylistLoading,
    error: fixedPlaylistError
  } = useFixedPlaylist()
  const { logs: consoleLogs, addLog } = useConsoleLogsContext()

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
  const { healthStatus, setHealthStatus, signalManualPlaybackAction } = useSpotifyHealthMonitor(fixedPlaylistId)

  // Create a more reliable playback state indicator
  const getIsActuallyPlaying = useCallback(() => {
    if (!playbackState) return false
    
    // If the SDK says it's not playing, it's not playing
    if (!playbackState.is_playing) return false
    
    // If we have a track and it's supposed to be playing, trust the SDK state
    // The health monitor will handle detecting stalled progress
    return true
  }, [playbackState])

  // Initialize the player when the component mounts
  useEffect(() => {
    const initializePlayer = async (): Promise<void> => {
      if (!isReady && typeof window !== 'undefined' && window.Spotify) {
        try {
          addLog('INFO', 'Initializing Spotify player...', 'AdminPage')
          await createPlayer()
          addLog('INFO', 'Spotify player initialized successfully', 'AdminPage')
        } catch (error) {
          addLog('ERROR', 'Failed to initialize Spotify player', 'AdminPage', error)
        }
      }
    }

    void initializePlayer()
  }, [isReady, createPlayer, addLog])

  // Update health status when device ID or fixed playlist changes
  useEffect(() => {
    if (!deviceId && !isReady) {
      const newDeviceStatus = 'unknown'

      setHealthStatus((prev: HealthStatus) => ({
        ...prev,
        device: newDeviceStatus
      }))
    }
  }, [deviceId, isReady, setHealthStatus])

  const handlePlayPause = useCallback(async (): Promise<void> => {
    if (!deviceId) return

    try {
      setIsLoading(true)
      const spotifyApi = SpotifyApiService.getInstance()

      if (getIsActuallyPlaying()) {
        // If currently playing, pause playback
        signalManualPlaybackAction('pause')
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
          setHealthStatus((prev: HealthStatus) => ({
            ...prev,
            playback: 'paused'
          }))
        } else {
          throw new Error('Failed to pause playback')
        }
      } else {
        // If not playing, resume playback
        signalManualPlaybackAction('play')
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
          setHealthStatus((prev: HealthStatus) => ({
            ...prev,
            playback: 'playing'
          }))
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
      setHealthStatus((prev: HealthStatus) => ({
        ...prev,
        playback: 'error'
      }))
    } finally {
      setIsLoading(false)
    }
  }, [deviceId, getIsActuallyPlaying, addLog, setHealthStatus, signalManualPlaybackAction])

  // Manual recovery trigger for user-initiated recovery (e.g., device mismatch, connection issues)
  const handleForceRecovery = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      addLog('INFO', 'Manual recovery triggered by user', 'AdminPage')
      
      // Update health status to indicate recovery is in progress
      setHealthStatus((prev: HealthStatus) => ({
        ...prev,
        recovery: 'recovering',
        recoveryMessage: 'Manual recovery in progress...',
        recoveryProgress: 0,
        recoveryCurrentStep: 'manual_trigger'
      }))
      
      // Note: The actual recovery logic is handled by the health monitor
      // This button is for manual recovery when automatic recovery hasn't triggered
      // but the user wants to force a recovery (e.g., for device mismatch issues)
      
    } catch (error) {
      addLog(
        'ERROR',
        `Manual recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'AdminPage',
        error
      )
      setError(error instanceof Error ? error.message : 'Manual recovery failed')
    } finally {
      setIsLoading(false)
    }
  }, [addLog, setHealthStatus])

  // Create a wrapper for the force recovery handler
  const handleForceRecoveryClick = useCallback((): void => {
    void handleForceRecovery()
  }, [handleForceRecovery])

  // Add missing functions
  const handleTabChange = useCallback((value: string): void => {
    setActiveTab(value as 'dashboard' | 'playlist' | 'settings' | 'logs')
  }, [])

  const handleTrackSuggestionsStateChange = useCallback((state: TrackSuggestionsState): void => {
    updateTrackSuggestionsState(state)
  }, [updateTrackSuggestionsState])

  const formatTime = useCallback((ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }, [])

  useEffect(() => {
    addLog('INFO', `AdminPage render: playbackState=${JSON.stringify(playbackState)}, healthStatus.playback=${healthStatus.playback}`, 'AdminPage')
  }, [playbackState, healthStatus.playback])

  // Update error handling
  if (fixedPlaylistError) {
    return (
      <div className='p-4 text-red-500'>
        <p>Error loading playlist: {fixedPlaylistError.message}</p>
      </div>
    )
  }

  if (isFixedPlaylistLoading) {
    return (
      <div className='p-4 text-gray-500'>
        <p>Loading playlist...</p>
      </div>
    )
  }

  if (playlistRefreshError) {
    return (
      <div className='p-4 text-red-500'>
        <p>Error refreshing playlist: {playlistRefreshError}</p>
      </div>
    )
  }

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <RecoveryStatus
        isRecovering={healthStatus.recovery === 'recovering'}
        message={healthStatus.recoveryMessage}
        progress={healthStatus.recoveryProgress}
        currentStep={healthStatus.recoveryCurrentStep}
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
              <div className='mb-4 rounded border border-red-500 bg-red-900/50 p-4 text-red-100'>
                {error}
              </div>
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
                  disabled={
                    !isReady ||
                    isLoading ||
                    healthStatus.recovery === 'recovering'
                  }
                  className={`text-white flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    getIsActuallyPlaying()
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isLoading
                    ? 'Loading...'
                    : !isReady
                      ? 'Initializing...'
                      : healthStatus.recovery === 'recovering'
                        ? 'Recovering...'
                        : getIsActuallyPlaying()
                          ? 'Pause'
                          : 'Play'}
                </button>
                <button
                  onClick={() => void refreshPlaylist(trackSuggestionsState)}
                  disabled={
                    !isReady ||
                    isLoading ||
                    healthStatus.recovery === 'recovering'
                  }
                  className='text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : !isReady
                      ? 'Initializing...'
                      : healthStatus.recovery === 'recovering'
                        ? 'Recovering...'
                        : 'Refresh Playlist'}
                </button>
                <button
                  onClick={handleForceRecoveryClick}
                  disabled={isLoading}
                  className='text-white flex-1 rounded-lg bg-orange-600 px-4 py-2 font-medium transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading
                    ? 'Loading...'
                    : healthStatus.recovery === 'recovering'
                      ? 'Recovering...'
                      : 'Manual Recovery'}
                </button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value='settings'>
            <TrackSuggestionsTab
              onStateChange={handleTrackSuggestionsStateChange}
            />
          </TabsContent>

          <TabsContent value='playlist'>
            <PlaylistDisplay playlistId={fixedPlaylistId ?? ''} />
          </TabsContent>
        </Tabs>

        <div className='mt-8'>
          <h2 className='mb-4 text-xl font-semibold'>Console Logs</h2>
          <div className='max-h-96 space-y-2 overflow-y-auto rounded-lg bg-gray-800/50 p-4'>
            {consoleLogs.map((log, index) => (
              <div
                key={index}
                className={`rounded p-2 ${
                  log.level === 'ERROR'
                    ? 'bg-red-900/50'
                    : log.level === 'WARN'
                      ? 'bg-yellow-900/50'
                      : 'bg-gray-700/50'
                }`}
              >
                <div className='flex items-center justify-between'>
                  <span className='font-mono text-sm'>{log.timestamp}</span>
                  <span
                    className={`rounded px-2 py-1 text-xs ${
                      log.level === 'ERROR'
                        ? 'bg-red-500'
                        : log.level === 'WARN'
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                    }`}
                  >
                    {log.level}
                  </span>
                </div>
                <p className='mt-1'>{log.message}</p>
                {log.error && (
                  <pre className='mt-2 overflow-x-auto rounded bg-gray-900/50 p-2 text-xs'>
                    {JSON.stringify(log.error, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

