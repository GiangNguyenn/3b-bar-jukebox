'use client'

import { useState, useEffect } from 'react'
import { HealthStatus } from '@/shared/types/health'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { StatusGrid } from './components/status-grid'
import { PlaybackControls } from './components/playback-controls'
import { ErrorBoundary } from './components/error-boundary'

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

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) {
          return 120 // Reset to 2 minutes
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const handlePlayPause = (): void => {
    setIsLoading(true)
    try {
      // Implementation
    } catch {
      // Handle error
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkipNext = (): void => {
    setIsLoading(true)
    try {
      // Implementation
    } catch {
      // Handle error
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkipPrevious = (): void => {
    setIsLoading(true)
    try {
      // Implementation
    } catch {
      // Handle error
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
          isReady={!isLoading}
          fixedPlaylistIsInitialFetchComplete={false}
        />
      </ErrorBoundary>

      <ErrorBoundary>
        <PlaybackControls
          playbackState={playbackInfo}
          canControlPlayback={!isLoading && playbackInfo !== null}
          onPlayPause={handlePlayPause}
          onSkipNext={handleSkipNext}
          onSkipPrevious={handleSkipPrevious}
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
