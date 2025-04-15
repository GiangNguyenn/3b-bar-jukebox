'use client'

import { useState, useEffect } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import {
  PlaybackControls,
  UptimeDisplay,
  ConsoleLogs,
  StatusGrid
} from './components'
import { ErrorBoundary } from './components/error-boundary'
import { HealthStatus } from './types'

interface DashboardTabProps {
  healthStatus: HealthStatus
}

export function DashboardTab({ healthStatus }: DashboardTabProps): JSX.Element {
  const [error] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [uptime, setUptime] = useState(0)
  const [logs, setLogs] = useState<string[]>([])

  const isReady = useSpotifyPlayer((state) => state.isReady)
  const playbackState = useSpotifyPlayer((state) => state.playbackState)
  const { isInitialFetchComplete: fixedPlaylistIsInitialFetchComplete } =
    useFixedPlaylist()

  useEffect(() => {
    const interval = setInterval(() => {
      setUptime((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const handlePlaybackControl = async (
    action: 'play' | 'pause' | 'next' | 'previous'
  ): Promise<void> => {
    try {
      setIsLoading(true)
      // TODO: Implement playback control logic
      await new Promise((resolve) => setTimeout(resolve, 100)) // Simulate async operation
      console.log(`Playback control: ${action}`)
      setLogs((prev) => [
        ...prev,
        `[${new Date().toISOString()}] Playback control: ${action}`
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleTokenRefresh = async (): Promise<void> => {
    try {
      setIsLoading(true)
      // TODO: Implement token refresh logic
      await new Promise((resolve) => setTimeout(resolve, 100)) // Simulate async operation
      console.log('Refreshing token')
      setLogs((prev) => [
        ...prev,
        `[${new Date().toISOString()}] Refreshing token`
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handlePlaylistRefresh = async (): Promise<void> => {
    try {
      setIsLoading(true)
      // TODO: Implement playlist refresh logic
      await new Promise((resolve) => setTimeout(resolve, 100)) // Simulate async operation
      console.log('Refreshing playlist')
      setLogs((prev) => [
        ...prev,
        `[${new Date().toISOString()}] Refreshing playlist`
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='space-y-4'>
      {error && (
        <div className='rounded-lg border border-red-800 bg-red-900/50 p-4 text-red-100'>
          {error}
        </div>
      )}

      {/* Status Grid */}
      <ErrorBoundary>
        <StatusGrid
          healthStatus={healthStatus}
          playbackState={playbackState}
          isReady={isReady}
          fixedPlaylistIsInitialFetchComplete={
            fixedPlaylistIsInitialFetchComplete
          }
        />
      </ErrorBoundary>

      {/* Playback Controls */}
      <ErrorBoundary>
        <PlaybackControls
          isLoading={isLoading}
          tokenExpiryTime={null} // TODO: Get from context or props
          fixedPlaylistIsInitialFetchComplete={
            fixedPlaylistIsInitialFetchComplete
          }
          playbackState={playbackState}
          onPlaybackControl={handlePlaybackControl}
          onTokenRefresh={handleTokenRefresh}
          onPlaylistRefresh={handlePlaylistRefresh}
        />
      </ErrorBoundary>

      {/* Uptime Display */}
      <ErrorBoundary>
        <UptimeDisplay uptime={uptime} />
      </ErrorBoundary>

      {/* Console Logs */}
      <ErrorBoundary>
        <ConsoleLogs logs={logs} />
      </ErrorBoundary>
    </div>
  )
}
