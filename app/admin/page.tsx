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
    addedTrack: boolean;
    upcomingTracksPercentage: number;
  } | null>(null)
  const [autoResumeAttempts, setAutoResumeAttempts] = useState(0)
  const wasPlaying = useRef(false)
  const lastPlayingTime = useRef<number | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const MAX_AUTO_RESUME_ATTEMPTS = 3
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const { fixedPlaylistId } = useFixedPlaylist()

  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    const fetchPlaybackState = async () => {
      if (!isMounted) return;

      try {
        const response = await fetch('/api/playback-state')
        if (!isMounted) return;

        if (response.ok) {
          const data = await response.json()
          if (!isMounted) return;

          setPlaybackState(data)
          
          // If we were playing and now we're not, and it's not because of another device
          if (wasPlaying.current && !data.is_playing && data.device?.id === deviceId) {
            console.log('Playback stopped unexpectedly, attempting to resume')
            handlePlayback('play')
          }
        }
      } catch (error) {
        console.error('Error fetching playback state:', error)
      } finally {
        // Schedule next check only if component is still mounted
        if (isMounted) {
          timeoutId = setTimeout(fetchPlaybackState, 2000)
        }
      }
    }

    // Initial fetch
    fetchPlaybackState()

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [deviceId])

  useEffect(() => {
    let isMounted = true;
    let refreshInterval: NodeJS.Timeout;

    const refreshSite = async () => {
      if (!isMounted) return;

      try {
        setIsRefreshing(true)
        setRefreshError(null)
        const response = await fetch('/api/refresh-site')
        if (!isMounted) return;

        const data = await response.json()
        if (!isMounted) return;
        
        if (!response.ok) {
          throw new Error(data.message || 'Failed to refresh site')
        }
        
        setLastRefreshTime(new Date())
        if (data.diagnosticInfo) {
          setPlaylistStats({
            totalTracks: data.diagnosticInfo.totalTracks,
            upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
            removedTrack: data.diagnosticInfo.removedTrack,
            addedTrack: data.diagnosticInfo.addedTrack,
            upcomingTracksPercentage: data.diagnosticInfo.upcomingTracksCount / data.diagnosticInfo.totalTracks * 100
          })
        }
      } catch (error) {
        console.error('Error refreshing site:', error)
        if (isMounted) {
          setRefreshError(error instanceof Error ? error.message : 'Failed to refresh site')
        }
      } finally {
        if (isMounted) {
          setIsRefreshing(false)
        }
      }
    }

    // Initial refresh
    refreshSite()

    // Set up interval for subsequent refreshes
    refreshInterval = setInterval(refreshSite, 120000) // 2 minutes

    return () => {
      isMounted = false;
      if (refreshInterval) {
        clearInterval(refreshInterval)
      }
    }
  }, [])

  useEffect(() => {
    // Update wasPlaying reference based on current state
    if (playbackState?.is_playing && playbackState.device?.id === deviceId) {
      wasPlaying.current = true
      lastPlayingTime.current = Date.now()
      // Reset auto-resume attempts when playing successfully
      if (autoResumeAttempts > 0) {
        setAutoResumeAttempts(0)
      }
    } else if (playbackState?.device?.id !== deviceId) {
      // Clear wasPlaying if another device is active
      wasPlaying.current = false
    }
  }, [playbackState, deviceId])

  // Request wake lock to prevent system sleep
  useEffect(() => {
    let wakeLockTimeout: NodeJS.Timeout;
    let isAndroid = /Android/i.test(navigator.userAgent);

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen')
          console.log('Wake Lock is active')
          
          // On Android, wake lock might be released by the system
          if (isAndroid) {
            wakeLock.current.addEventListener('release', () => {
              console.log('Wake Lock was released by the system, attempting to reacquire')
              requestWakeLock()
            })
          }
        }
      } catch (err) {
        console.error('Error requesting wake lock:', err)
        // On Android, retry after a delay if wake lock fails
        if (isAndroid) {
          wakeLockTimeout = setTimeout(requestWakeLock, 5000)
        }
      }
    }

    requestWakeLock()

    return () => {
      if (wakeLockTimeout) {
        clearTimeout(wakeLockTimeout)
      }
      if (wakeLock.current) {
        wakeLock.current.release()
          .then(() => {
            wakeLock.current = null
            console.log('Wake Lock released')
          })
      }
    }
  }, [])

  // Handle visibility changes with Android-specific handling
  useEffect(() => {
    let isMounted = true;
    let visibilityTimeout: NodeJS.Timeout;
    let isAndroid = /Android/i.test(navigator.userAgent);
    let lastCheckTime = Date.now();

    const handleVisibilityChange = async () => {
      if (!isMounted) return;

      const now = Date.now();
      // On Android, check more frequently when hidden
      const checkInterval = isAndroid ? 2000 : 5000;

      if (document.hidden) {
        // Page is hidden, try to maintain playback
        if (wasPlaying.current && deviceId && isReady && fixedPlaylistId) {
          try {
            const response = await fetch('/api/playback-state')
            if (!isMounted) return;
            
            if (response.ok) {
              const state = await response.json()
              if (!isMounted) return;
              
              if (!state.is_playing) {
                console.log('Playback stopped while page was hidden, attempting to resume')
                handlePlayback('play')
              }
            }
          } catch (error) {
            console.error('Error checking playback state while hidden:', error)
          }
        }
      } else {
        // Page is visible again, check and resume if needed
        if (wasPlaying.current && deviceId && isReady && fixedPlaylistId) {
          try {
            const response = await fetch('/api/playback-state')
            if (!isMounted) return;
            
            if (response.ok) {
              const state = await response.json()
              if (!isMounted) return;
              
              if (!state.is_playing) {
                console.log('Page became visible, playback stopped while hidden. Attempting to resume.')
                handlePlayback('play')
              }
            }
          } catch (error) {
            console.error('Error checking playback state on visibility change:', error)
          }
        }
      }

      // Schedule next check
      if (isMounted) {
        const timeSinceLastCheck = now - lastCheckTime;
        const delay = Math.max(0, checkInterval - timeSinceLastCheck);
        visibilityTimeout = setTimeout(handleVisibilityChange, delay);
        lastCheckTime = now;
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Start periodic checks
    visibilityTimeout = setTimeout(handleVisibilityChange, isAndroid ? 2000 : 5000)

    return () => {
      isMounted = false;
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout)
      }
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
        // Special handling for the case where music is playing on another device
        if (response.status === 409) {
          setError(`${data.error}${data.details ? ` (${data.details.currentDevice}: ${data.details.currentTrack})` : ''}`)
          // Don't attempt auto-resume in this case
          wasPlaying.current = false
          return
        }
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
              {!deviceId ? 'Waiting for Spotify player to initialize...' : 
               playbackState?.is_playing && playbackState?.device?.id !== deviceId ? 
               'Music already playing on another device' : 
               'Waiting for player to be ready...'}
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
                    <span className="text-gray-500">Upcoming %:</span>
                    <span className="ml-2">{playlistStats.upcomingTracksPercentage.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Last Action:</span>
                    <span className="ml-2">
                      {playlistStats.removedTrack ? 'Track Removed' : 
                       playlistStats.addedTrack ? 'Track Added' : 
                       'No Changes'}
                    </span>
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