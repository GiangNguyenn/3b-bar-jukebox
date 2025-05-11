'use client'

import { useState, useEffect } from 'react'
import { HealthStatus } from '@/shared/types/health'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { StatusGrid } from './components/status-grid'
import { PlaybackControls } from './components/playback-controls'
import { ErrorBoundary } from './components/error-boundary'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'

interface DashboardTabProps {
  healthStatus: HealthStatus
  playbackInfo: SpotifyPlaybackState | null
}

export function DashboardTab({
  healthStatus,
  playbackInfo
}: DashboardTabProps): JSX.Element {
  const [error] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number>(120) // 2 minutes in seconds
  const isPlayerReady = useSpotifyPlayer((state) => state.isReady)
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

    return () => clearInterval(interval)
  }, [])

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const handlePlayPause = (): void => {
    if (isLoading) return
    setIsLoading(true)
    try {
      // Implementation
    } catch (error) {
      console.error('Play/Pause failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkipNext = (): void => {
    if (isLoading) return
    setIsLoading(true)
    try {
      // Implementation
    } catch (error) {
      console.error('Skip next failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkipPrevious = (): void => {
    if (isLoading) return
    setIsLoading(true)
    try {
      // Implementation
    } catch (error) {
      console.error('Skip previous failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='space-y-6'>
      <ErrorBoundary>
        <StatusGrid
          healthStatus={healthStatus}
          playbackState={playbackInfo}
          isReady={isPlayerReady && !isLoading}
          fixedPlaylistIsInitialFetchComplete={isInitialFetchComplete}
        />
      </ErrorBoundary>

      <ErrorBoundary>
        <PlaybackControls
          playbackState={playbackInfo}
          canControlPlayback={
            isPlayerReady && !isLoading && playbackInfo !== null
          }
          onPlayPause={() => handlePlayPause()}
          onSkipNext={() => handleSkipNext()}
          onSkipPrevious={() => handleSkipPrevious()}
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
