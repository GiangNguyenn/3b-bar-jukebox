'use client'

import { useState, useEffect, useRef } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import SpotifyPlayer from '@/components/SpotifyPlayer'

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const playbackState = useSpotifyPlayer((state) => state.playbackState)
  const { fixedPlaylistId } = useFixedPlaylist()
  const wakeLock = useRef<WakeLockSentinel | null>(null)

  // Keep screen on with Wake Lock
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen')
          console.log('Screen will stay on')
        }
      } catch (err) {
        console.error('Wake Lock Error:', err)
      }
    }

    requestWakeLock()

    return () => {
      if (wakeLock.current) {
        wakeLock.current.release()
          .then(() => {
            wakeLock.current = null
            console.log('Screen can now sleep')
          })
      }
    }
  }, [])

  const handlePlayback = async (action: 'play' | 'skip') => {
    try {
      setIsLoading(true)
      setError(null)

      if (!deviceId) {
        throw new Error('No active Spotify device found')
      }

      if (action === 'play' && !fixedPlaylistId) {
        throw new Error('No playlist configured')
      }

      // Get current track and position
      const currentState = await fetch('/api/playback-state').then(res => res.json())
      const currentTrack = currentState?.item?.uri
      const position_ms = currentState?.progress_ms || 0

      const response = await fetch('/api/playback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          deviceId,
          // Only send contextUri if we don't have a current track to resume from
          contextUri: action === 'play' && !currentTrack ? `spotify:playlist:${fixedPlaylistId}` : undefined,
          position_ms: action === 'play' ? position_ms : undefined,
          offset: action === 'play' && currentTrack ? { uri: currentTrack } : undefined
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        // Special handling for the case where music is playing on another device
        if (response.status === 409) {
          setError(`${data.error}${data.details ? ` (${data.details.currentDevice}: ${data.details.currentTrack})` : ''}`)
          return
        }
        throw new Error(data.error || 'Failed to control playback')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to control playback')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRefresh = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/refresh-site')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to refresh site')
      }

      // Dispatch refresh event for the player to handle
      window.dispatchEvent(new CustomEvent('playlistRefresh'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh site')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <SpotifyPlayer />
      
      <div className="max-w-xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold mb-8">Admin Controls</h1>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-100 p-4 rounded mb-4">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 p-4 rounded-lg bg-gray-900/50 border border-gray-800">
          <div className={`w-3 h-3 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
          <span className="font-medium">
            {isReady ? 'Player Ready' : 'Player Initializing...'}
          </span>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => handlePlayback('play')}
            disabled={isLoading || !deviceId || !isReady || !fixedPlaylistId}
            className={`
              flex-1 px-6 py-3 rounded font-semibold
              ${isLoading || !deviceId || !isReady || !fixedPlaylistId
                ? 'bg-green-900/30 text-green-100/50 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-500 active:bg-green-700'
              }
            `}
          >
            {isLoading ? 'Loading...' : 'Play'}
          </button>

          <button
            onClick={() => handlePlayback('skip')}
            disabled={isLoading || !deviceId || !isReady}
            className={`
              flex-1 px-6 py-3 rounded font-semibold
              ${isLoading || !deviceId || !isReady
                ? 'bg-red-900/30 text-red-100/50 cursor-not-allowed'
                : 'bg-red-600 hover:bg-red-500 active:bg-red-700'
              }
            `}
          >
            {isLoading ? 'Loading...' : 'Skip'}
          </button>

          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className={`
              flex-1 px-6 py-3 rounded font-semibold
              ${isLoading
                ? 'bg-blue-900/30 text-blue-100/50 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700'
              }
            `}
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  )
} 