'use client'

import { useCallback, useState, useEffect } from 'react'
import { useRecoverySystem } from '@/hooks/recovery'
import { RecoveryStatus } from '../recovery-status'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { ErrorBoundary } from './components/error-boundary'
import { PlaybackControls } from './components/playback-controls'
import { StatusGrid } from './components/status-grid'
import { UptimeDisplay } from './components/uptime-display'
import { type HealthStatus } from './types'
import { type SpotifyPlaybackState, type SpotifyTrack } from '@/shared/types/spotify'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyApiService } from '@/services/spotifyApi'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import { PlaylistRefreshService } from '@/services/playlistRefresh'
import { sendApiRequest } from '@/shared/api'

export function Dashboard(): JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<'playPause' | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    deviceId: null,
    device: 'unknown',
    playback: 'paused',
    token: 'valid',
    tokenExpiringSoon: false,
    connection: 'unknown',
    fixedPlaylist: 'unknown'
  })
  const [uptime, setUptime] = useState(0)
  const [timeLeft, setTimeLeft] = useState(120) // 2 minutes in seconds
  const [isRefreshingPlaylist, setIsRefreshingPlaylist] = useState(false)

  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const playbackState = useSpotifyPlayer((state) => state.playbackState)
  const setPlaybackState = useSpotifyPlayer((state) => state.setPlaybackState)
  const { fixedPlaylistId } = useFixedPlaylist()
  const { addLog } = useConsoleLogsContext()
  const { data: playlist } = useGetPlaylist(fixedPlaylistId ?? null)

  const {
    state: recoveryState,
    recover,
    reset: resetRecovery,
    playbackState: recoveryPlaybackState
  } = useRecoverySystem(
    deviceId,
    fixedPlaylistId,
    useCallback((status) => {
      setHealthStatus((prev) => ({
        ...prev,
        device: status.device,
        deviceId
      }))
    }, [deviceId])
  )

  const handleForceRecovery = useCallback(async () => {
    try {
      addLog(
        'INFO',
        `[Recovery] Starting manual recovery: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
      setIsLoading(true)
      resetRecovery()
      await recover()
    } catch (error) {
      addLog(
        'ERROR',
        `[Recovery] Error during recovery: error=${error instanceof Error ? error.message : 'Unknown error'}, errorType=${error instanceof Error ? error.name : 'Unknown'}, stack=${error instanceof Error ? error.stack : 'N/A'}, deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsLoading(false)
    }
  }, [recover, deviceId, fixedPlaylistId, resetRecovery, addLog])

  const handlePlayPause = useCallback(async () => {
    if (!deviceId) return

    try {
    setIsLoading(true)
    setLoadingAction('playPause')
      const spotifyApi = SpotifyApiService.getInstance()

      if (playbackState?.is_playing) {
        // If currently playing, pause playback
        await sendApiRequest({
          path: `me/player/pause?device_id=${deviceId}`,
          method: 'PUT'
        })
        addLog(
          'INFO',
          `[Playback] Paused successfully: deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
          'Playback',
          undefined
        )
          } else {
        // If not playing, resume playback
        const result = await spotifyApi.resumePlayback()
        if (result.success) {
          addLog(
            'INFO',
            `[Playback] Resumed successfully: resumedFrom=${typeof result.resumedFrom === 'string' ? result.resumedFrom : JSON.stringify(result.resumedFrom)}, deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
            'Playback',
            undefined
          )
        } else {
          throw new Error('Failed to resume playback')
        }
      }

      // Add a small delay to allow the Spotify API to update
      await new Promise(resolve => setTimeout(resolve, 500))

      // Refresh the playback state
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id === deviceId) {
        setPlaybackState(state)
      }
    } catch (error) {
      addLog(
        'ERROR',
        '[Playback] Control failed',
        'Playback',
        error instanceof Error ? error : undefined
      )
    } finally {
        setIsLoading(false)
        setLoadingAction(null)
    }
  }, [deviceId, playbackState?.is_playing, addLog, setPlaybackState])

  const handleRefreshPlaylist = useCallback(async () => {
    if (!deviceId || !fixedPlaylistId) return

    try {
      setIsRefreshingPlaylist(true)
      const refreshService = new PlaylistRefreshService()
      await refreshService.refreshPlaylist(fixedPlaylistId)
      addLog(
        'INFO',
        `[Playlist] Refreshed successfully: playlistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Playlist',
        undefined
      )
    } catch (error) {
      addLog(
        'ERROR',
        '[Playlist] Refresh failed',
        'Playlist',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsRefreshingPlaylist(false)
    }
  }, [deviceId, fixedPlaylistId, addLog])

  // Add effect to handle recovery state cleanup and log success/failure
  useEffect(() => {
    if (recoveryState.phase === 'success') {
      addLog(
        'INFO',
        `[Recovery] Recovery completed successfully: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
    } else if (recoveryState.phase === 'error') {
      addLog(
        'ERROR',
        `[Recovery] Recovery failed: deviceId=${deviceId}, fixedPlaylistId=${fixedPlaylistId}, timestamp=${new Date().toISOString()}`,
        'Recovery',
        undefined
      )
    }
    if (recoveryState.phase === 'success' || recoveryState.phase === 'error') {
      const cleanupTimer = setTimeout(() => {
        resetRecovery()
      }, 3000) // Reset after 3 seconds

      return () => clearTimeout(cleanupTimer)
    }
    return () => {} // Return empty cleanup function for other cases
  }, [recoveryState.phase, resetRecovery, addLog, deviceId, fixedPlaylistId])

  // Add effect to handle automatic recovery for server errors
  useEffect(() => {
    if (recoveryPlaybackState?.error) {
      const error = recoveryPlaybackState.error
      if (error.includes('Server error') || error.includes('500')) {
        addLog(
          'WARN',
          '[Playback] Server error detected, attempting recovery...',
          'Playback',
          undefined
        )
        void recover()
      }
    }
  }, [recoveryPlaybackState?.error, recover, addLog])

  // Add effect to update uptime
  useEffect(() => {
    const startTime = Date.now()
    const interval = setInterval(() => {
      setUptime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Add effect to update auto-refresh timer
  useEffect(() => {
    function updateTimeLeft(): void {
      setTimeLeft((prev: number): number => {
        if (prev <= 0) {
          return 120 // Reset to 2 minutes
        }
        return prev - 1
      })
    }

    const interval = setInterval(updateTimeLeft, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-6">
      <RecoveryStatus state={recoveryState} />
      
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
      <ErrorBoundary>
        <StatusGrid
          healthStatus={healthStatus}
          playbackState={playbackState}
              isReady={isReady && !loadingAction}
              fixedPlaylistIsInitialFetchComplete={healthStatus.fixedPlaylist === 'found'}
        />
      </ErrorBoundary>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Controls</h2>
            <div className="flex gap-4">
          <button
            onClick={handlePlayPause}
                disabled={!isReady || !deviceId || isLoading || recoveryState.isRecovering}
                className={`text-white flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  playbackState?.is_playing
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
                {isLoading
                  ? 'Loading...'
                  : !isReady
                    ? 'Initializing...'
                    : recoveryState.isRecovering
                      ? 'Recovering...'
                      : playbackState?.is_playing
                        ? 'Pause'
                        : 'Play'}
          </button>

          <button
            onClick={handleRefreshPlaylist}
                disabled={!isReady || !deviceId || isLoading || isRefreshingPlaylist || recoveryState.isRecovering}
                className="text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading
                  ? 'Loading...'
                  : !isReady
                    ? 'Initializing...'
                    : recoveryState.isRecovering
                      ? 'Recovering...'
                      : isRefreshingPlaylist
                        ? 'Refreshing...'
                        : 'Refresh Playlist'}
          </button>

          <button
            onClick={handleForceRecovery}
                disabled={isLoading || recoveryState.isRecovering}
                className="text-white flex-1 rounded-lg bg-red-600 px-4 py-2 font-medium transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading
                  ? 'Loading...'
                  : recoveryState.isRecovering
                    ? 'Recovering...'
                    : 'Force Recovery'}
          </button>
        </div>
      </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-400">
              Next Auto-Refresh
            </h3>
            <p className="text-2xl font-semibold text-gray-300">
              {timeLeft > 0 ? formatTime(timeLeft) : 'Refreshing...'}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <UptimeDisplay uptime={uptime} />
        </div>
      </div>
    </div>
  )
} 