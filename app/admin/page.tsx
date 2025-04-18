/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type EffectCallback
} from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { SpotifyPlayer } from '@/components/SpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, TokenInfo } from '@/shared/types'
import { formatDate } from '@/lib/utils'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { TrackSuggestionsTab } from './components/track-suggestions/track-suggestions-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleLogs } from '@/hooks/useConsoleLogs'
import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds
const DEVICE_CHECK_INTERVAL = {
  good: 30000, // 30 seconds
  unstable: 15000, // 15 seconds
  poor: 10000, // 10 seconds
  unknown: 5000 // 5 seconds for initial checks
}
const MAX_RECOVERY_ATTEMPTS = 3

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown'
  playback: 'playing' | 'paused' | 'stopped' | 'error' | 'unknown'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  connection: 'good' | 'unstable' | 'poor' | 'unknown'
  tokenExpiringSoon: boolean
  fixedPlaylist: 'found' | 'not_found' | 'error' | 'unknown'
}

interface PlaylistCheckedInfo {
  timestamp: number
  hasChanges: boolean
}

interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
}

interface RefreshResponse {
  success: boolean
  message?: string
  searchDetails?: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails: Array<{
      name: string
      popularity: number
      isExcluded: boolean
      isPlayable: boolean
      duration_ms: number
      explicit: boolean
    }>
  }
}

interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
  lastSuggestedTrack?: {
    name: string
    artist: string
    album: string
    uri: string
  }
}

export default function AdminPage(): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [_error, setError] = useState<string | null>(null)
  const [timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'unknown',
    playback: 'unknown',
    token: 'unknown',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [networkErrorCount, setNetworkErrorCount] = useState(0)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const { fixedPlaylistId, isInitialFetchComplete } = useFixedPlaylist()
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const lastRefreshTime = useRef<number>(Date.now())
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const isRefreshing = useRef<boolean>(false)
  const maxRecoveryAttempts = 5
  const baseDelay = 2000 // 2 seconds
  const { logs: consoleLogs, addLog } = useConsoleLogs()
  const [uptime, setUptime] = useState(0)
  const [tokenInfo, _setTokenInfo] = useState<TokenInfo>({
    lastRefresh: 0,
    expiresIn: 0,
    scope: '',
    type: '',
    lastActualRefresh: 0,
    expiryTime: 0
  })
  const [_currentYear, _setCurrentYear] = useState(new Date().getFullYear())
  const [trackSuggestionsState, setTrackSuggestionsState] =
    useState<TrackSuggestionsState | null>(null)
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const { refreshToken } = useSpotifyPlayerState(fixedPlaylistId ?? '')

  const handleRefresh = useCallback(async (): Promise<void> => {
    if (isRefreshing.current) return
    isRefreshing.current = true
    setIsLoading(true)
    setError(null)

    try {
      // Get track suggestions state from localStorage
      const savedState = localStorage.getItem('track-suggestions-state')
      const trackSuggestionsState = savedState
        ? (JSON.parse(savedState) as TrackSuggestionsState)
        : {
            genres: Array.from(FALLBACK_GENRES),
            yearRange: [1950, new Date().getFullYear()],
            popularity: 50,
            allowExplicit: false,
            maxSongLength: 300,
            songsBetweenRepeats: 5
          }

      const response = await fetch('/api/refresh-site', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          genres: trackSuggestionsState.genres,
          yearRangeStart: trackSuggestionsState.yearRange[0],
          yearRangeEnd: trackSuggestionsState.yearRange[1],
          popularity: trackSuggestionsState.popularity,
          allowExplicit: trackSuggestionsState.allowExplicit,
          maxSongLength: trackSuggestionsState.maxSongLength,
          songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats
        })
      })

      const data = (await response.json()) as RefreshResponse

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to refresh site')
      }

      console.log('[Refresh] Success:', data.message)
      lastRefreshTime.current = Date.now()
      setTimeUntilRefresh(REFRESH_INTERVAL)
      addLog('INFO', 'Playlist refreshed successfully')
    } catch (err) {
      console.error('[Refresh] Error:', err)
      setError('Failed to refresh site')
      addLog(
        'ERROR',
        'Failed to refresh playlist',
        undefined,
        err instanceof Error ? err : new Error(String(err))
      )
    } finally {
      setIsLoading(false)
      isRefreshing.current = false
    }
  }, [setError, setIsLoading, setTimeUntilRefresh, addLog])

  // Set mounted state
  useEffect((): void => {
    setMounted(true)
  }, [])

  const updateTokenStatus = useCallback((): void => {
    const now = Date.now()
    const timeUntilExpiry = tokenInfo.expiryTime - now
    const minutesUntilExpiry = timeUntilExpiry / (60 * 1000)

    if (tokenInfo.expiryTime === 0) {
      setHealthStatus((prev) => ({
        ...prev,
        token: 'unknown'
      }))
      return
    }

    if (minutesUntilExpiry < 0) {
      setHealthStatus((prev) => ({
        ...prev,
        token: 'error'
      }))
      return
    }

    setHealthStatus((prev) => ({
      ...prev,
      token: 'valid',
      tokenExpiringSoon: minutesUntilExpiry < 15
    }))
  }, [tokenInfo.expiryTime])

  // Listen for token events from SpotifyPlayer
  useEffect(() => {
    const handleTokenUpdate = (event: CustomEvent<TokenInfo>) => {
      _setTokenInfo(event.detail)
      updateTokenStatus()
    }

    window.addEventListener('tokenUpdate', handleTokenUpdate as EventListener)
    return () => {
      window.removeEventListener(
        'tokenUpdate',
        handleTokenUpdate as EventListener
      )
    }
  }, [updateTokenStatus])

  // Keep periodic status updates
  const statusEffect: EffectCallback = () => {
    if (!mounted) return

    const statusInterval = setInterval(updateTokenStatus, 60000) // Check every minute
    updateTokenStatus() // Initial status update

    return () => {
      clearInterval(statusInterval)
    }
  }

  useEffect(statusEffect, [mounted, updateTokenStatus])

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (recoveryAttempts >= maxRecoveryAttempts) {
      console.error('[Recovery] Max attempts reached')
      return
    }

    try {
      // First, try to refresh the player state
      if (typeof window.refreshSpotifyPlayer === 'function') {
        await window.refreshSpotifyPlayer()
      }

      // Then try to reconnect the player
      if (typeof window.spotifyPlayerInstance?.connect === 'function') {
        await window.spotifyPlayerInstance.connect()
      }

      // If we get here, recovery was successful
      setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
      setRecoveryAttempts(0)
    } catch (error) {
      console.error('[Recovery] Failed:', error)
      setRecoveryAttempts((prev) => prev + 1)

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, recoveryAttempts)
      recoveryTimeout.current = setTimeout(() => {
        void attemptRecovery()
      }, delay)
    }
  }, [recoveryAttempts])

  // Listen for player verification errors
  useEffect(() => {
    const handlePlayerError = (
      event: CustomEvent<{ error?: { message?: string } }>
    ): void => {
      if (
        event.detail?.error?.message?.includes('Player verification failed')
      ) {
        console.error('[Player] Verification failed')
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      }
    }

    window.addEventListener('playerError', handlePlayerError as EventListener)

    return (): void => {
      window.removeEventListener(
        'playerError',
        handlePlayerError as EventListener
      )
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [attemptRecovery])

  // Device health check and recovery
  useEffect(() => {
    const checkDeviceHealth = async (): Promise<void> => {
      if (!deviceId) {
        setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
        void attemptRecovery()
        return
      }

      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!state?.device?.id) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        if (state.device.id !== deviceId) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
        setRecoveryAttempts(0)
      } catch (error) {
        console.error('[Device] Health check failed:', error)
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      }
    }

    const getCheckInterval = (): number => {
      return DEVICE_CHECK_INTERVAL[healthStatus.connection]
    }

    deviceCheckInterval.current = setInterval(() => {
      void checkDeviceHealth()
    }, getCheckInterval())

    return (): void => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [deviceId, healthStatus.connection, attemptRecovery])

  // Request wake lock to prevent device sleep
  useEffect(() => {
    const requestWakeLock = async (): Promise<void> => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen')
        }
      } catch (error) {
        console.error('[WakeLock] Failed:', error)
      }
    }

    void requestWakeLock()

    return (): void => {
      if (wakeLock.current) {
        void wakeLock.current.release()
      }
    }
  }, [])

  // Automatic periodic refresh every 2 minutes
  const autoRefreshEffect: EffectCallback = () => {
    const refreshInterval = setInterval(() => {
      if (!isLoading) {
        // Don't refresh if already loading
        void (async () => {
          try {
            setIsLoading(true)

            // Get track suggestions state from localStorage
            const savedState = localStorage.getItem('track-suggestions-state')
            const trackSuggestionsState = savedState
              ? (JSON.parse(savedState) as TrackSuggestionsState)
              : {
                  genres: Array.from(FALLBACK_GENRES),
                  yearRange: [1950, new Date().getFullYear()],
                  popularity: 50,
                  allowExplicit: false,
                  maxSongLength: 300,
                  songsBetweenRepeats: 5
                }

            const response = await fetch('/api/refresh-site', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                genres: trackSuggestionsState.genres,
                yearRangeStart: trackSuggestionsState.yearRange[0],
                yearRangeEnd: trackSuggestionsState.yearRange[1],
                popularity: trackSuggestionsState.popularity,
                allowExplicit: trackSuggestionsState.allowExplicit,
                maxSongLength: trackSuggestionsState.maxSongLength,
                songsBetweenRepeats: trackSuggestionsState.songsBetweenRepeats
              })
            })

            const data = (await response.json()) as RefreshResponse

            if (!response.ok) {
              console.error(
                '[Refresh] Failed:',
                data.message ?? 'Unknown error'
              )
              return
            }

            // Dispatch refresh event for the player to handle
            window.dispatchEvent(new CustomEvent('playlistRefresh'))
            lastRefreshTime.current = Date.now()
          } catch (err) {
            console.error('[Refresh] Error:', err)
          } finally {
            setIsLoading(false)
          }
        })()
      }
    }, REFRESH_INTERVAL)

    return () => clearInterval(refreshInterval)
  }

  useEffect(autoRefreshEffect, [isLoading])

  // Network error handling and recovery
  const networkEffect = () => {
    const attemptNetworkRecovery = async (): Promise<void> => {
      try {
        const response = await fetch('/api/playback-state')
        if (!response.ok) {
          throw new Error('Network error')
        }
        setNetworkErrorCount(0)
        setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
      } catch (error) {
        console.error('[Network] Recovery failed:', error)
        setNetworkErrorCount((prev) => prev + 1)
        if (networkErrorCount >= 3) {
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        } else {
          setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
        }
      }
    }

    const handleNetworkError = () => {
      setNetworkErrorCount((prev) => prev + 1)
      if (networkErrorCount >= 3) {
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
      } else {
        setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
      }
      void attemptNetworkRecovery()
    }

    const handleOffline = () => {
      setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
    }

    const handleOnline = () => {
      void attemptNetworkRecovery()
    }

    // Initial connection check
    void attemptNetworkRecovery()

    // Set up event listeners
    window.addEventListener('error', handleNetworkError)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('error', handleNetworkError)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }

  useEffect(networkEffect, [networkErrorCount])

  // Countdown timer with debounced refresh
  const timerEffect: EffectCallback = () => {
    const timer = setInterval((): void => {
      const now = Date.now()
      const timeSinceLastRefresh = now - lastRefreshTime.current
      const remainingTime = Math.max(0, REFRESH_INTERVAL - timeSinceLastRefresh)
      setTimeUntilRefresh(remainingTime)

      // Trigger refresh when timer reaches zero and not already refreshing
      if (remainingTime === 0 && !isRefreshing.current) {
        void handleRefresh()
      }
    }, 1000)

    return () => clearInterval(timer)
  }

  useEffect(timerEffect, [handleRefresh])

  // Listen for playback state updates from SpotifyPlayer
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const playbackEffect = () => {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const handlePlaybackUpdate = (event: CustomEvent<PlaybackInfo>) => {
      setPlaybackInfo(event.detail)
      setHealthStatus((prev) => ({
        ...prev,
        playback: event.detail.isPlaying ? 'playing' : 'paused'
      }))
    }

    window.addEventListener(
      'playbackUpdate',
      handlePlaybackUpdate as EventListener
    )

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    return () => {
      window.removeEventListener(
        'playbackUpdate',
        handlePlaybackUpdate as EventListener
      )
    }
  }

  useEffect(playbackEffect, [])

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const handlePlaylistChecked = useCallback(
    (event: CustomEvent<PlaylistCheckedInfo>) => {
      const { hasChanges } = event.detail
      if (hasChanges) {
        void handleRefresh()
      }
    },
    [handleRefresh]
  )

  // Listen for playlist change status updates
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const playlistEffect = () => {
    window.addEventListener(
      'playlistChecked',
      handlePlaylistChecked as EventListener
    )
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    return () => {
      window.removeEventListener(
        'playlistChecked',
        handlePlaylistChecked as EventListener
      )
    }
  }

  useEffect(playlistEffect, [handlePlaylistChecked])

  // Uptime timer
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  useEffect(() => {
    const startTime = Date.now()
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const timer = setInterval(() => {
      setUptime(Date.now() - startTime)
    }, 1000)

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    return () => clearInterval(timer)
  }, [])

  // Update FixedPlaylist status
  useEffect(() => {
    if (fixedPlaylistId) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'found' }))
    } else if (isInitialFetchComplete) {
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'not_found' }))
    }
  }, [fixedPlaylistId, isInitialFetchComplete])

  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const handlePlayback = async (action: 'play' | 'skip'): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      if (action === 'play') {
        // Get current state to ensure we resume at the right track
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        await sendApiRequest({
          path: 'me/player/play',
          method: 'PUT',
          body: {
            context_uri: `spotify:playlist:${fixedPlaylistId}`,
            position_ms: state?.progress_ms ?? 0,
            offset: state?.item?.uri ? { uri: state.item.uri } : undefined
          }
        })
      } else {
        await sendApiRequest({
          path: 'me/player/next',
          method: 'POST'
        })
      }

      setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
    } catch (error) {
      console.error('[Playback] Control failed:', error)
      setError('Failed to control playback')
      setHealthStatus((prev) => ({ ...prev, playback: 'error' }))

      // Attempt automatic recovery
      try {
        // First try to refresh the player state
        if (typeof window.refreshSpotifyPlayer === 'function') {
          await window.refreshSpotifyPlayer()
        }

        // Then try to reconnect the player
        if (typeof window.spotifyPlayerInstance?.connect === 'function') {
          await window.spotifyPlayerInstance.connect()
        }

        // Finally try the original playback action again
        if (action === 'play') {
          // Get current state to ensure we resume at the right track
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: state?.progress_ms ?? 0,
              offset: state?.item?.uri ? { uri: state.item.uri } : undefined
            }
          })
        } else {
          await sendApiRequest({
            path: 'me/player/next',
            method: 'POST'
          })
        }

        // If we get here, recovery was successful
        setError(null)
        setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
      } catch (recoveryError) {
        console.error('[Playback] Recovery failed:', recoveryError)
        // Keep the original error state if recovery fails
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleTokenRefresh = async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)
      await refreshToken()
      console.log('[Token] Manual refresh triggered successfully')
    } catch (error) {
      console.error('[Token] Manual refresh failed:', error)
      setError('Failed to refresh token')
      setHealthStatus((prev) => ({ ...prev, token: 'error' }))
    } finally {
      setIsLoading(false)
    }
  }

  const handleTrackSuggestionsRefresh = async (): Promise<void> => {
    if (!trackSuggestionsState) {
      addLog('ERROR', 'No track suggestions state available')
      return
    }

    setIsRefreshingSuggestions(true)
    setRefreshError(null)

    try {
      const response = await fetch('/api/track-suggestions/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(trackSuggestionsState)
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = (await response.json()) as RefreshResponse

      if (data.success) {
        addLog(
          'INFO',
          'Track suggestions refreshed successfully',
          JSON.stringify(data.searchDetails)
        )
      } else {
        throw new Error(data.message ?? 'Failed to refresh track suggestions')
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'
      setRefreshError(errorMessage)
      addLog(
        'ERROR',
        'Failed to refresh track suggestions',
        undefined,
        error instanceof Error ? error : new Error(errorMessage)
      )
    } finally {
      setIsRefreshingSuggestions(false)
    }
  }

  const handleTrackSuggestionsStateChange = (
    newState: TrackSuggestionsState
  ): void => {
    setTrackSuggestionsState(newState)
  }

  // Only render content after mounting to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className='text-white min-h-screen bg-black p-4'>Loading...</div>
    )
  }

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <SpotifyPlayer />

      <div className='mx-auto max-w-xl space-y-4'>
        <h1 className='mb-8 text-2xl font-bold'>Admin Controls</h1>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='space-y-4'
        >
          <TabsList className='grid w-full grid-cols-2 bg-gray-800/50'>
            <TabsTrigger
              value='dashboard'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value='track-suggestions'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Track Suggestions
            </TabsTrigger>
          </TabsList>

          <TabsContent value='dashboard'>
            {_error && (
              <div className='mb-4 rounded border border-red-500 bg-red-900/50 p-4 text-red-100'>
                {_error}
              </div>
            )}

            <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
              <div
                className={`h-3 w-3 rounded-full ${isReady ? 'bg-green-500' : 'bg-yellow-500'}`}
              />
              <span className='font-medium'>
                {isReady ? 'Player Ready' : 'Player Initializing...'}
              </span>
            </div>

            <div className='space-y-4'>
              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.device === 'healthy'
                      ? 'bg-green-500'
                      : healthStatus.device === 'unresponsive'
                        ? 'bg-yellow-500'
                        : healthStatus.device === 'disconnected'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.device === 'healthy'
                    ? 'Device Connected'
                    : healthStatus.device === 'unresponsive'
                      ? 'Device Unresponsive'
                      : healthStatus.device === 'disconnected'
                        ? 'Device Disconnected'
                        : 'Device Status Unknown'}
                  {recoveryAttempts > 0 &&
                    ` (Recovery ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})`}
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.playback === 'playing'
                      ? 'animate-pulse bg-green-500'
                      : healthStatus.playback === 'paused'
                        ? 'bg-yellow-500'
                        : healthStatus.playback === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <div className='flex flex-1 items-center gap-2'>
                  <span className='font-medium'>
                    {healthStatus.playback === 'playing'
                      ? 'Playback Active'
                      : healthStatus.playback === 'paused'
                        ? 'Playback Paused'
                        : healthStatus.playback === 'error'
                          ? 'Playback Error'
                          : 'Playback Stopped'}
                  </span>
                  {playbackInfo?.currentTrack && (
                    <span className='text-sm text-gray-400'>
                      -{' '}
                      <span className='text-white font-medium'>
                        {playbackInfo.currentTrack}
                      </span>{' '}
                      ({formatTime(playbackInfo.progress)})
                    </span>
                  )}
                </div>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.token === 'valid' &&
                    !healthStatus.tokenExpiringSoon
                      ? 'bg-green-500'
                      : healthStatus.token === 'valid' &&
                          healthStatus.tokenExpiringSoon
                        ? 'bg-yellow-500'
                        : healthStatus.token === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.token === 'valid' &&
                  !healthStatus.tokenExpiringSoon
                    ? 'Token Valid'
                    : healthStatus.token === 'valid' &&
                        healthStatus.tokenExpiringSoon
                      ? 'Token Expiring Soon'
                      : healthStatus.token === 'error'
                        ? 'Token Error'
                        : 'Token Status Unknown'}
                </span>
                <div className='group relative'>
                  <div className='invisible absolute left-0 top-0 z-10 rounded-lg bg-gray-800 p-2 text-xs text-gray-200 shadow-lg transition-all duration-200 group-hover:visible'>
                    <div className='whitespace-nowrap'>
                      <div>
                        Token expires: {formatDate(tokenInfo.expiryTime)}
                      </div>
                    </div>
                  </div>
                  <svg
                    className='h-4 w-4 cursor-help text-gray-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    />
                  </svg>
                </div>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.connection === 'good'
                      ? 'bg-green-500'
                      : healthStatus.connection === 'unstable'
                        ? 'bg-yellow-500'
                        : healthStatus.connection === 'poor'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.connection === 'good'
                    ? 'Connection Good'
                    : healthStatus.connection === 'unstable'
                      ? 'Connection Unstable'
                      : healthStatus.connection === 'poor'
                        ? 'Connection Poor'
                        : 'Connection Status Unknown'}
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
                <div
                  className={`h-3 w-3 rounded-full ${
                    healthStatus.fixedPlaylist === 'found'
                      ? 'bg-green-500'
                      : healthStatus.fixedPlaylist === 'not_found'
                        ? 'bg-red-500'
                        : healthStatus.fixedPlaylist === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                  }`}
                />
                <span className='font-medium'>
                  {healthStatus.fixedPlaylist === 'found'
                    ? 'Fixed Playlist Found'
                    : healthStatus.fixedPlaylist === 'not_found'
                      ? 'Fixed Playlist Not Found'
                      : healthStatus.fixedPlaylist === 'error'
                        ? 'Fixed Playlist Error'
                        : 'Fixed Playlist Status Unknown'}
                </span>
                <div className='group relative'>
                  <div className='invisible absolute left-0 top-0 z-10 rounded-lg bg-gray-800 p-2 text-xs text-gray-200 shadow-lg transition-all duration-200 group-hover:visible'>
                    <div className='whitespace-nowrap'>
                      <div>Playlist ID: {fixedPlaylistId ?? 'Not found'}</div>
                      <div>
                        Next auto-refresh in {formatTime(timeUntilRefresh)}
                      </div>
                    </div>
                  </div>
                  <svg
                    className='h-4 w-4 cursor-help text-gray-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    />
                  </svg>
                </div>
              </div>
            </div>

            <div className='mt-8 space-y-4'>
              <h2 className='text-xl font-semibold'>Controls</h2>
              <div className='flex gap-4'>
                <button
                  onClick={() => void handlePlayback('play')}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-green-600 px-4 py-2 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Play'}
                </button>
                <button
                  onClick={() => void handlePlayback('skip')}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Skip'}
                </button>
                <button
                  onClick={() => void handleRefresh()}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Refresh Playlist'}
                </button>
                <button
                  onClick={() => void handleTokenRefresh()}
                  disabled={isLoading || !isReady}
                  className='text-white flex-1 rounded-lg bg-orange-600 px-4 py-2 font-medium transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isLoading ? 'Loading...' : 'Refresh Token'}
                </button>
              </div>
              <div className='text-center text-sm text-gray-400'>
                <div className='flex flex-col items-center gap-2'>
                  <span>Uptime: {formatTime(uptime)}</span>
                </div>
              </div>
              <div className='mt-4'>
                <h3 className='mb-2 text-lg font-semibold'>Console Logs</h3>
                <div className='max-h-48 overflow-y-auto rounded-lg bg-gray-100 p-4'>
                  {consoleLogs.map((log, index) => (
                    <div
                      key={`${log.timestamp}-${index}`}
                      className={`text-sm ${
                        log.level === 'ERROR'
                          ? 'text-red-600'
                          : log.level === 'INFO'
                            ? 'text-green-600'
                            : 'text-gray-800'
                      }`}
                    >
                      {new Date(log.timestamp).toLocaleString()} -{' '}
                      {log.context ? `[${log.context}] ` : ''}
                      {log.message}
                      {log.error && (
                        <pre className='mt-1 rounded bg-gray-200 p-1 text-xs'>
                          {log.error.message}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value='track-suggestions'>
            <div className='space-y-6'>
              <TrackSuggestionsTab
                onStateChange={handleTrackSuggestionsStateChange}
              />
              <div className='flex items-center justify-end space-x-4'>
                {refreshError && (
                  <div className='text-sm text-red-500'>{refreshError}</div>
                )}
                <button
                  onClick={() => void handleTrackSuggestionsRefresh()}
                  disabled={isRefreshingSuggestions}
                  className='bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {isRefreshingSuggestions ? 'Refreshing...' : 'Refresh Now'}
                </button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
