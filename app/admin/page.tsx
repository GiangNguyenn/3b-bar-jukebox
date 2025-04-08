'use client'

import { useState, useEffect, useRef } from 'react'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import SpotifyPlayer from '@/components/SpotifyPlayer'
import { SpotifyPlaybackState } from '@/shared/types'

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null)
  const [playlistStats, setPlaylistStats] = useState<{
    totalTracks: number;
    upcomingTracksCount: number;
    removedTrack: boolean;
  } | null>(null)
  const [autoResumeAttempts, setAutoResumeAttempts] = useState(0)
  const wasPlaying = useRef(false)
  const lastPlayingTime = useRef<number | null>(null)
  const MAX_AUTO_RESUME_ATTEMPTS = 3
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
        if (data.diagnosticInfo) {
          setPlaylistStats({
            totalTracks: data.diagnosticInfo.totalTracks,
            upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
            removedTrack: data.diagnosticInfo.removedTrack
          })
        }
      } catch (error) {
        console.error('Error refreshing site:', error)
        setRefreshError(error instanceof Error ? error.message : 'Failed to refresh site')
      } finally {
        setIsRefreshing(false)
      }
    }, 120000) // 2 minutes in milliseconds

    return () => clearInterval(refreshInterval)
  }, [])

  useEffect(() => {
    const fetchPlaybackState = async () => {
      try {
        const response = await fetch('/api/playback-state')
        if (response.ok) {
          const data = await response.json()
          setPlaybackState(data)
        }
      } catch (error) {
        console.error('Error fetching playback state:', error)
      }
    }

    // Initial fetch
    fetchPlaybackState()

    // Update every 5 seconds
    const interval = setInterval(fetchPlaybackState, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Function to check if playback stopped unexpectedly
    const checkPlaybackContinuity = () => {
      // If player was playing before but is not playing now
      if (wasPlaying.current && playbackState && !playbackState.is_playing) {
        const currentTime = Date.now()
        const timeSinceLastPlaying = lastPlayingTime.current ? currentTime - lastPlayingTime.current : null
        
        // Only auto-resume if it's been less than 5 minutes since it was last playing
        // This prevents auto-resume at unwanted times (e.g., at the end of the day)
        if (timeSinceLastPlaying && timeSinceLastPlaying < 5 * 60 * 1000 && autoResumeAttempts < MAX_AUTO_RESUME_ATTEMPTS) {
          console.log(`Playback stopped unexpectedly. Attempting auto-resume (attempt ${autoResumeAttempts + 1})`)
          handlePlayback('play')
          setAutoResumeAttempts(prev => prev + 1)
        }
      }
      
      // Update wasPlaying reference based on current state
      if (playbackState?.is_playing) {
        wasPlaying.current = true
        lastPlayingTime.current = Date.now()
        // Reset auto-resume attempts when playing successfully
        if (autoResumeAttempts > 0) {
          setAutoResumeAttempts(0)
        }
      }
    }
    
    // Check playback continuity when playback state changes
    if (playbackState) {
      checkPlaybackContinuity()
    }
  }, [playbackState, fixedPlaylistId, deviceId, isReady, autoResumeAttempts])

  useEffect(() => {
    const handleVisibilityChange = () => {
      // When page becomes visible again
      if (!document.hidden && wasPlaying.current && deviceId && isReady && fixedPlaylistId) {
        // Check if music is still playing
        fetch('/api/playback-state')
          .then(response => response.ok ? response.json() : null)
          .then(state => {
            if (state && !state.is_playing) {
              console.log('Page became visible, playback stopped while page was hidden. Attempting to resume.')
              handlePlayback('play')
            }
          })
          .catch(error => {
            console.error('Error checking playback state on visibility change:', error)
          })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [deviceId, isReady, fixedPlaylistId])

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
          position_ms: action === 'play' && playbackState?.progress_ms ? playbackState.progress_ms : undefined
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

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const getProgressPercentage = () => {
    if (!playbackState?.item?.duration_ms || !playbackState?.progress_ms) return 0
    return (playbackState.progress_ms / playbackState.item.duration_ms) * 100
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

          <div className="flex gap-4 mb-6">
            <button 
              onClick={() => handlePlayback('play')}
              disabled={isLoading || !fixedPlaylistId || !deviceId || !isReady}
              className={`px-8 py-4 text-xl font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                playbackState?.is_playing 
                  ? 'bg-green-600 hover:bg-green-700 text-white' 
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
            >
              {isLoading ? 'Loading...' : playbackState?.is_playing ? 'Playing' : 'Play'}
            </button>
            <button 
              onClick={() => handlePlayback('skip')}
              disabled={isLoading || !deviceId || !isReady}
              className="px-8 py-4 text-xl font-medium bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading...' : 'Skip'}
            </button>
          </div>

          {/* Player Stats Section */}
          {playbackState && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-medium mb-3">Player Stats</h3>
              
              {/* Current Track */}
              {playbackState.item && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>{playbackState.item.name}</span>
                    <span>{formatTime(playbackState.progress_ms)} / {formatTime(playbackState.item.duration_ms)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className="bg-green-500 h-2.5 rounded-full" 
                      style={{ width: `${getProgressPercentage()}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Device Info */}
              {playbackState.device && (
                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div>
                    <span className="text-gray-500">Device:</span>
                    <span className="ml-2">{playbackState.device.name}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Volume:</span>
                    <span className="ml-2">{playbackState.device.volume_percent}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Shuffle:</span>
                    <span className="ml-2">{playbackState.shuffle_state ? 'On' : 'Off'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Repeat:</span>
                    <span className="ml-2 capitalize">{playbackState.repeat_state}</span>
                  </div>
                </div>
              )}

              {/* Playlist Stats */}
              {playlistStats && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Total Tracks:</span>
                    <span className="ml-2">{playlistStats.totalTracks}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Upcoming Tracks:</span>
                    <span className="ml-2">{playlistStats.upcomingTracksCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Last Action:</span>
                    <span className="ml-2">{playlistStats.removedTrack ? 'Track Removed' : 'No Changes'}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 