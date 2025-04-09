'use client'

import { useState, useEffect, useRef } from 'react'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import SpotifyPlayer from '@/components/SpotifyPlayer'
import { SpotifyPlaybackState } from '@/shared/types'

// Add WakeLockSentinel type if not already globally defined
declare global {
  interface WakeLockSentinel {
    released: boolean;
    type: 'screen';
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
    removeEventListener(type: 'release', listener: () => void): void;
  }
  interface Navigator {
    wakeLock?: {
      request(type: 'screen'): Promise<WakeLockSentinel>;
    };
  }
}

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null)
  const [showReinitialization, setShowReinitialization] = useState(false)
  const [reinitializationInfo, setReinitializationInfo] = useState<{
    timestamp: number;
    currentTrack: string;
    position: string;
  } | null>(null)
  const [playlistStats, setPlaylistStats] = useState<{
    totalTracks: number;
    upcomingTracksCount: number;
    removedTrack: boolean;
    addedTrack: boolean;
    upcomingTracksPercentage: number;
    previousTotalTracks?: number;
  } | null>(null)
  const lastPlaylistSnapshot = useRef<string | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const { fixedPlaylistId } = useFixedPlaylist()
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null)
  const [showNoChanges, setShowNoChanges] = useState(false)
  const [showPlayerCheck, setShowPlayerCheck] = useState(false)
  const eventListenersSet = useRef(false)

  // Add a ref to track the previous playlist state
  const previousPlaylistState = useRef<{
    totalTracks: number;
    upcomingTracksCount: number;
    removedTrack: boolean;
    addedTrack: boolean;
  } | null>(null)

  // Function to generate a snapshot of the current playlist state
  const generatePlaylistSnapshot = (stats: typeof playlistStats) => {
    if (!stats) return null;
    return JSON.stringify({
      totalTracks: stats.totalTracks,
      upcomingTracksCount: stats.upcomingTracksCount,
      removedTrack: stats.removedTrack,
      addedTrack: stats.addedTrack
    });
  };

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
        }
      } catch (error) {
        console.error('Error fetching playback state:', error)
      } finally {
        // Schedule next check only if component is still mounted
        if (isMounted) {
          timeoutId = setTimeout(fetchPlaybackState, 10000)
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

  // Set up initial refresh and interval
  useEffect(() => {
    let isMounted = true;
    let refreshInterval: NodeJS.Timeout;

    const refreshSite = async () => {
      try {
        setIsRefreshing(true);
        setRefreshError(null);
        setLastCheckTime(new Date());
        
        console.log('[Admin] Starting site refresh');
        const response = await fetch('/api/refresh-site');
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.message || 'Failed to refresh site');
        }
        
        if (data.diagnosticInfo) {
          console.log('[Admin] Received diagnostic info:', data.diagnosticInfo);
          const newStats = {
            totalTracks: data.diagnosticInfo.totalTracks,
            upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
            removedTrack: data.diagnosticInfo.removedTrack,
            addedTrack: data.diagnosticInfo.addedTrack,
            upcomingTracksPercentage: data.diagnosticInfo.upcomingTracksCount / data.diagnosticInfo.totalTracks * 100,
            previousTotalTracks: previousPlaylistState.current?.totalTracks || 0
          };

          // Check for changes by comparing with previous state
          const hasChanges = 
            data.diagnosticInfo.removedTrack || 
            data.diagnosticInfo.addedTrack || 
            (previousPlaylistState.current && 
             (data.diagnosticInfo.totalTracks !== previousPlaylistState.current.totalTracks ||
              data.diagnosticInfo.upcomingTracksCount !== previousPlaylistState.current.upcomingTracksCount));

          console.log('[Admin] Playlist change detection:', {
            hasChanges,
            current: {
              totalTracks: data.diagnosticInfo.totalTracks,
              upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
              removedTrack: data.diagnosticInfo.removedTrack,
              addedTrack: data.diagnosticInfo.addedTrack
            },
            previous: previousPlaylistState.current
          });

          // Update the previous state
          previousPlaylistState.current = {
            totalTracks: data.diagnosticInfo.totalTracks,
            upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
            removedTrack: false, // Reset these flags after detection
            addedTrack: false   // Reset these flags after detection
          };

          setPlaylistStats(newStats);
          setLastRefreshTime(new Date());

          if (hasChanges) {
            console.log('[Admin] Playlist changes detected, dispatching refresh event');
            window.dispatchEvent(new CustomEvent('playlistRefresh'));
          } else {
            console.log('[Admin] No playlist changes detected');
            setShowNoChanges(true);
            setTimeout(() => setShowNoChanges(false), 2000);
          }
        }
      } catch (error) {
        console.error('[Admin] Error refreshing site:', error);
        setRefreshError(error instanceof Error ? error.message : 'Failed to refresh site');
      } finally {
        setIsRefreshing(false);
      }
    };

    // Initial refresh
    refreshSite();

    // Set up interval for subsequent refreshes
    refreshInterval = setInterval(refreshSite, 120000); // 2 minutes

    return () => {
      isMounted = false;
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, []); // Empty dependency array since we only want to set up once

  // Keep Wake Lock useEffect
  useEffect(() => {
    let wakeLockTimeout: NodeJS.Timeout;
    let isAndroid = /Android/i.test(navigator.userAgent);

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && navigator.wakeLock) {
          wakeLock.current = await navigator.wakeLock.request('screen')
          console.log('Wake Lock is active')
          
          // On Android, wake lock might be released by the system
          if (isAndroid) {
            wakeLock.current.addEventListener('release', () => {
              console.log('Wake Lock was released by the system, attempting to reacquire')
              // Only reacquire if the component is still mounted and lock is null
              if (wakeLock.current === null) {
                 requestWakeLock()
              }
            })
          }
        }
      } catch (err: any) {
        console.error(`Wake Lock Error: ${err.name}, ${err.message}`);
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

  // Simplified visibility change handler without auto-resume
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

  // Set up event listeners for playlist changes
  useEffect(() => {
    console.log('[Admin] Setting up event listeners');
    
    const handlePlaylistReinitialized = (e: CustomEvent) => {
      console.log('[Admin] Received playlistReinitialized event:', e.detail);
      setReinitializationInfo({
        timestamp: e.detail.timestamp,
        currentTrack: e.detail.currentTrack,
        position: e.detail.position
      });
      setShowReinitialization(true);
      setTimeout(() => setShowReinitialization(false), 2000);
    };

    const handlePlaylistChangeStatus = async () => {
      console.log('[Admin] Received getPlaylistChangeStatus event');
      
      // If we have no stats yet, trigger a refresh
      if (!playlistStats) {
        console.log('[Admin] No playlist stats available, triggering refresh');
        try {
          const response = await fetch('/api/refresh-site');
          const data = await response.json();
          
          if (data.diagnosticInfo) {
            const newStats = {
              totalTracks: data.diagnosticInfo.totalTracks,
              upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
              removedTrack: false, // Reset these flags for initial state
              addedTrack: false,   // Reset these flags for initial state
              upcomingTracksPercentage: data.diagnosticInfo.upcomingTracksCount / data.diagnosticInfo.totalTracks * 100,
              previousTotalTracks: 0
            };

            // Set initial state without triggering a change
            previousPlaylistState.current = {
              totalTracks: data.diagnosticInfo.totalTracks,
              upcomingTracksCount: data.diagnosticInfo.upcomingTracksCount,
              removedTrack: false,
              addedTrack: false
            };

            setPlaylistStats(newStats);
            
            // Since this is the first time we're getting stats, we don't want to trigger a change
            window.dispatchEvent(new CustomEvent('playlistChangeStatus', {
              detail: { hasChanges: false }
            }));
          }
        } catch (error) {
          console.error('[Admin] Error fetching initial playlist stats:', error);
          window.dispatchEvent(new CustomEvent('playlistChangeStatus', {
            detail: { hasChanges: false }
          }));
        }
        return;
      }

      // Check for any changes in the playlist
      const hasChanges = 
        (playlistStats.removedTrack && !previousPlaylistState.current?.removedTrack) || 
        (playlistStats.addedTrack && !previousPlaylistState.current?.addedTrack) || 
        (previousPlaylistState.current && 
         (playlistStats.totalTracks !== previousPlaylistState.current.totalTracks ||
          playlistStats.upcomingTracksCount !== previousPlaylistState.current.upcomingTracksCount));

      console.log('[Admin] Playlist change status:', {
        hasChanges,
        current: playlistStats,
        previous: previousPlaylistState.current
      });

      // Update the previous state after checking for changes
      if (hasChanges) {
        previousPlaylistState.current = {
          totalTracks: playlistStats.totalTracks,
          upcomingTracksCount: playlistStats.upcomingTracksCount,
          removedTrack: playlistStats.removedTrack,
          addedTrack: playlistStats.addedTrack
        };
      }

      window.dispatchEvent(new CustomEvent('playlistChangeStatus', {
        detail: { hasChanges }
      }));
    };

    const handlePlaylistChecked = (e: CustomEvent) => {
      console.log('[Admin] Received playlistChecked event:', e.detail);
      setShowPlayerCheck(true);
      setTimeout(() => setShowPlayerCheck(false), 2000);
    };

    // Add event listeners
    window.addEventListener('playlistReinitialized', handlePlaylistReinitialized as EventListener);
    window.addEventListener('getPlaylistChangeStatus', handlePlaylistChangeStatus as EventListener);
    window.addEventListener('playlistChecked', handlePlaylistChecked as EventListener);

    console.log('[Admin] Event listeners set up successfully');

    return () => {
      console.log('[Admin] Cleaning up event listeners');
      window.removeEventListener('playlistReinitialized', handlePlaylistReinitialized as EventListener);
      window.removeEventListener('getPlaylistChangeStatus', handlePlaylistChangeStatus as EventListener);
      window.removeEventListener('playlistChecked', handlePlaylistChecked as EventListener);
    };
  }, []); // Empty dependency array since we only want to set up once

  // Separate effect to handle playlistStats changes
  useEffect(() => {
    if (playlistStats) {
      console.log('[Admin] Playlist stats updated:', playlistStats);
      // Update the previous state
      previousPlaylistState.current = {
        totalTracks: playlistStats.totalTracks,
        upcomingTracksCount: playlistStats.upcomingTracksCount,
        removedTrack: playlistStats.removedTrack,
        addedTrack: playlistStats.addedTrack
      };
    }
  }, [playlistStats]);

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
          {showReinitialization && reinitializationInfo && (
            <div className="mb-4 p-4 bg-blue-100 text-blue-700 rounded animate-fade-in-out">
              <div className="font-medium mb-1">Playlist Updated</div>
              <div className="text-sm">
                <div>Reinitializing playback at:</div>
                <div className="ml-2">• Track: {reinitializationInfo.currentTrack}</div>
                <div className="ml-2">• Position: {reinitializationInfo.position}</div>
              </div>
            </div>
          )}
          {showNoChanges && (
            <div className="mb-4 p-4 bg-gray-100 text-gray-600 rounded animate-fade-in-out">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm">No playlist changes detected</span>
              </div>
              {lastCheckTime && (
                <div className="text-xs mt-1 text-gray-500">
                  Last checked: {lastCheckTime.toLocaleTimeString()}
                </div>
              )}
            </div>
          )}
          {showPlayerCheck && (
            <div className="mb-4 p-4 bg-purple-100 text-purple-600 rounded animate-fade-in-out">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-sm">Spotify player checking for changes...</span>
              </div>
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
            <button
              onClick={() => {
                if (typeof window !== 'undefined' && window.refreshSpotifyPlayer) {
                  window.refreshSpotifyPlayer();
                }
              }}
              className="px-8 py-4 text-xl font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Refresh Player
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