'use client'

import { useState } from 'react'
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

      {error && (
        <div className='rounded-lg border border-destructive bg-destructive/10 p-4'>
          <p className='text-sm text-destructive'>{error}</p>
        </div>
      )}
    </div>
  )
}
