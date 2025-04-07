'use client'

import { useState } from 'react'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import SpotifyPlayer from '@/components/SpotifyPlayer'

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const { fixedPlaylistId } = useFixedPlaylist()

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