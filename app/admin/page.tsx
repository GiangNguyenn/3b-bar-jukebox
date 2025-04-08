'use client'

import { useState, useEffect } from 'react'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import SpotifyPlayer from '@/components/SpotifyPlayer'

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const { fixedPlaylistId } = useFixedPlaylist()

  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      try {
        setIsRefreshing(true)
        setRefreshError(null)
        const response = await fetch('/api/refresh-site')
        const data = await response.json()
        
        if (!response.ok) {
          throw new Error(data.message || 'Failed to refresh site')
        }
        
        setLastRefreshTime(new Date())
      } catch (error) {
        console.error('Error refreshing site:', error)
        setRefreshError(error instanceof Error ? error.message : 'Failed to refresh site')
      } finally {
        setIsRefreshing(false)
      }
    }, 120000) // 2 minutes in milliseconds

    return () => clearInterval(refreshInterval)
  }, [])

  const handlePlayback = async (action: 'play' | 'skip') => {
    try {
      setIsLoading(true)
      setError(null)

      // Wait for a short time to ensure the player is fully ready
      await new Promise(resolve => setTimeout(resolve, 500))

      const response = await fetch('/api/playback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          contextUri: action === 'play' ? `spotify:playlist:${fixedPlaylistId}` : undefined,
          deviceId: deviceId || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('Playback error:', data)
        throw new Error(data.error || data.details?.error?.message || 'Failed to control playback')
      }
    } catch (error) {
      console.error('Error controlling playback:', error)
      setError(error instanceof Error ? error.message : 'An unknown error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <SpotifyPlayer />
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
      <div className="grid gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Welcome to the Admin Panel</h2>
          {error && (
            <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
              {error}
            </div>
          )}
          {!deviceId || !isReady ? (
            <div className="mb-4 p-4 bg-yellow-100 text-yellow-700 rounded">
              {!deviceId ? 'Waiting for Spotify player to initialize...' : 'Waiting for player to be ready...'}
            </div>
          ) : null}
          <div className="flex items-center gap-2 mb-4 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${isRefreshing ? 'bg-yellow-500 animate-pulse' : refreshError ? 'bg-red-500' : 'bg-green-500'}`} />
            <span className={refreshError ? 'text-red-600' : 'text-gray-600'}>
              {isRefreshing ? 'Refreshing...' : 
               refreshError ? `Refresh failed: ${refreshError}` :
               lastRefreshTime ? `Last refreshed: ${lastRefreshTime.toLocaleTimeString()}` : 
               'Waiting for first refresh...'}
            </span>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => handlePlayback('play')}
              disabled={isLoading || !fixedPlaylistId || !deviceId || !isReady}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading...' : 'Play'}
            </button>
            <button 
              onClick={() => handlePlayback('skip')}
              disabled={isLoading || !deviceId || !isReady}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading...' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 