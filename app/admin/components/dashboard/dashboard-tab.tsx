'use client'

import { useState, useEffect } from 'react'
import { HealthStatus } from '@/shared/types/health'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { StatusGrid } from './components/status-grid'
import { PlaybackControls } from './components/playback-controls'
import { ErrorBoundary } from './components/error-boundary'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { sendApiRequest } from '@/shared/api'

interface DashboardTabProps {
  healthStatus: HealthStatus
  playbackInfo: SpotifyPlaybackState | null
}

export function DashboardTab({
  healthStatus,
  playbackInfo
}: DashboardTabProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<
    'playPause' | 'next' | 'previous' | null
  >(null)
  const [timeLeft, setTimeLeft] = useState<number>(120) // 2 minutes in seconds
  const isPlayerReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const { isInitialFetchComplete } = useFixedPlaylist()

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

    return (): void => clearInterval(interval)
  }, [])

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const handlePlayPause = async (): Promise<void> => {
    if (loadingAction || !deviceId) return
    setLoadingAction('playPause')
    setError(null)
    try {
      if (playbackInfo?.is_playing) {
        await sendApiRequest({
          path: `me/player/pause?device_id=${deviceId}`,
          method: 'PUT'
        })
      } else {
        await sendApiRequest({
          path: `me/player/play?device_id=${deviceId}`,
          method: 'PUT'
        })
      }
    } catch (error) {
      console.error('Play/Pause failed:', error)
      setError('Failed to control playback')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleSkipNext = async (): Promise<void> => {
    if (loadingAction || !deviceId) return
    setLoadingAction('next')
    setError(null)
    try {
      await sendApiRequest({
        path: `me/player/next?device_id=${deviceId}`,
        method: 'POST'
      })
    } catch (error) {
      console.error('Skip next failed:', error)
      setError('Failed to skip to next track')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleSkipPrevious = async (): Promise<void> => {
    if (loadingAction || !deviceId) return
    setLoadingAction('previous')
    setError(null)
    try {
      await sendApiRequest({
        path: `me/player/previous?device_id=${deviceId}`,
        method: 'POST'
      })
    } catch (error) {
      console.error('Skip previous failed:', error)
      setError('Failed to skip to previous track')
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className='space-y-6'>
      <ErrorBoundary>
        <StatusGrid
          healthStatus={healthStatus}
          playbackState={playbackInfo}
          isReady={isPlayerReady && !loadingAction}
          fixedPlaylistIsInitialFetchComplete={isInitialFetchComplete}
        />
      </ErrorBoundary>

      <ErrorBoundary>
        <PlaybackControls
          playbackState={playbackInfo}
          canControlPlayback={isPlayerReady && deviceId !== null}
          isLoading={loadingAction !== null}
          loadingAction={loadingAction}
          onPlayPause={() => void handlePlayPause()}
          onSkipNext={() => void handleSkipNext()}
          onSkipPrevious={() => void handleSkipPrevious()}
        />
      </ErrorBoundary>

      <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
        <h3 className='mb-2 text-sm font-medium text-gray-400'>
          Next Auto-Refresh
        </h3>
        <p className='text-2xl font-semibold text-gray-300'>
          {timeLeft > 0 ? formatTime(timeLeft) : 'Refreshing...'}
        </p>
      </div>

      {error && (
        <div className='rounded-lg border border-destructive bg-destructive/10 p-4'>
          <p className='text-sm text-destructive'>{error}</p>
        </div>
      )}
    </div>
  )
}
