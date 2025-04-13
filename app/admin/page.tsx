'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { SpotifyPlayer } from '@/components/SpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, SpotifyPlaylistItem } from '@/shared/types'

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds
const DEVICE_CHECK_INTERVAL = {
  good: 30000, // 30 seconds
  unstable: 15000, // 15 seconds
  poor: 10000, // 10 seconds
  unknown: 5000 // 5 seconds for initial checks
}
const MAX_RECOVERY_ATTEMPTS = 3
const TOKEN_CHECK_INTERVAL = 120000 // 2 minutes in milliseconds
const TOKEN_REFRESH_THRESHOLD = 300000 // 5 minutes in milliseconds
const TOKEN_EXPIRATION_BUFFER = 60000 // 1 minute buffer

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown'
  playback: 'playing' | 'paused' | 'stopped' | 'error' | 'unknown'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  connection: 'good' | 'unstable' | 'poor' | 'unknown'
}

interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
}

interface RefreshResponse {
  message?: string
  success: boolean
}

export default function AdminPage(): JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'unknown',
    playback: 'unknown',
    token: 'unknown',
    connection: 'unknown'
  })
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [networkErrorCount, setNetworkErrorCount] = useState(0)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const { fixedPlaylistId } = useFixedPlaylist()
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const lastRefreshTime = useRef<number>(Date.now())
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const tokenCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const isRefreshing = useRef<boolean>(false)
  const maxRecoveryAttempts = 5
  const baseDelay = 2000 // 2 seconds
  const [consoleLogs, setConsoleLogs] = useState<string[]>([])
  const [uptime, setUptime] = useState(0)
  const [tokenInfo, setTokenInfo] = useState<{
    lastRefresh: number
    expiresIn: number
    scope: string
    type: string
    remainingTime: number
    lastActualRefresh: number
  }>({
    lastRefresh: 0,
    expiresIn: 0,
    scope: '',
    type: '',
    remainingTime: 0,
    lastActualRefresh: 0
  })

  const formatTokenTime = (timestamp: number): string => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }

  // Check token validity and refresh if needed
  useEffect(() => {
    const checkToken = async (): Promise<void> => {
      try {
        // First check if token is about to expire
        const now = Date.now()
        const timeUntilExpiration = tokenInfo.lastRefresh + tokenInfo.expiresIn - now

        // If token is about to expire, refresh it proactively
        if (timeUntilExpiration < TOKEN_REFRESH_THRESHOLD) {
          console.log('[Token] Proactively refreshing token (expires in:', formatTimeRemaining(timeUntilExpiration), ')')
          const refreshResponse = await fetch('/api/token', {
            method: 'GET',
            cache: 'no-store'
          })

          if (refreshResponse.ok) {
            const data = await refreshResponse.json()
            const newRefreshTime = Date.now()
            setTokenInfo((prev) => ({
              ...prev,
              lastRefresh: newRefreshTime,
              expiresIn: data.expires_in * 1000,
              scope: data.scope,
              type: data.token_type,
              lastActualRefresh: newRefreshTime,
              remainingTime: data.expires_in * 1000
            }))
            setHealthStatus((prev) => ({ ...prev, token: 'valid' }))
            return
          }
        }

        // If token is not about to expire, validate it
        const response = await sendApiRequest<{ items: SpotifyPlaylistItem[] }>(
          {
            path: '/me/playlists',
            method: 'GET'
          }
        )

        if (response) {
          setHealthStatus((prev) => ({ ...prev, token: 'valid' }))
          return
        }
      } catch (error) {
        console.error('[Token] Validation failed:', error)
        // Don't immediately set token to error, try to refresh first
      }

      // If we get here, either validation failed or proactive refresh failed
      try {
        const refreshResponse = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-store'
        })

        if (refreshResponse.ok) {
          const data = await refreshResponse.json()
          const now = Date.now()
          console.log('[Token] Refreshed at:', new Date(now).toISOString())
          setTokenInfo((prev) => ({
            ...prev,
            lastRefresh: now,
            expiresIn: data.expires_in * 1000,
            scope: data.scope,
            type: data.token_type,
            lastActualRefresh: now,
            remainingTime: data.expires_in * 1000
          }))
          setHealthStatus((prev) => ({ ...prev, token: 'valid' }))
          return
        }

        // If refresh fails, check if we can still play music
        const playbackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (playbackState?.is_playing) {
          // If music is playing, token is actually valid despite refresh failure
          setHealthStatus((prev) => ({ ...prev, token: 'valid' }))
          return
        }

        // Only set token to error if we can't play music
        console.error('[Token] Refresh failed - no playback')
        setHealthStatus((prev) => ({ ...prev, token: 'error' }))
      } catch (error) {
        console.error('[Token] Refresh failed:', error)
        // Only set token to error if we can't play music
        try {
          const playbackState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })
          if (playbackState?.is_playing) {
            setHealthStatus((prev) => ({ ...prev, token: 'valid' }))
            return
          }
        } catch (playbackError) {
          console.error('[Token] Final check failed:', playbackError)
          setHealthStatus((prev) => ({ ...prev, token: 'error' }))
        }
      }
    }

    // Initial check
    void checkToken()

    // Set up interval
    tokenCheckInterval.current = setInterval(() => {
      void checkToken()
    }, TOKEN_CHECK_INTERVAL)

    return (): void => {
      if (tokenCheckInterval.current) {
        clearInterval(tokenCheckInterval.current)
      }
    }
  }, [tokenInfo.lastRefresh, tokenInfo.expiresIn])

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
  useEffect(() => {
    const refreshInterval = setInterval((): void => {
      if (!isLoading) {
        // Don't refresh if already loading
        void (async (): Promise<void> => {
          try {
            setIsLoading(true)
            const response = await fetch('/api/refresh-site')
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

    return (): void => clearInterval(refreshInterval)
  }, [isLoading])

  // Network error handling and recovery
  useEffect(() => {
    const handleNetworkError = (): void => {
      setNetworkErrorCount((prev) => prev + 1)
      if (networkErrorCount >= 3) {
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        void attemptNetworkRecovery()
      }
    }

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
        }
      }
    }

    window.addEventListener('offline', handleNetworkError)
    window.addEventListener('online', () => void attemptNetworkRecovery())

    return (): void => {
      window.removeEventListener('offline', handleNetworkError)
      window.removeEventListener('online', () => void attemptNetworkRecovery())
    }
  }, [networkErrorCount])

  // Countdown timer with debounced refresh
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      const timeSinceLastRefresh = now - lastRefreshTime.current
      const remainingTime = Math.max(0, REFRESH_INTERVAL - timeSinceLastRefresh)
      setTimeUntilRefresh(remainingTime)

      // Trigger refresh when timer reaches zero and not already refreshing
      if (remainingTime === 0 && !isRefreshing.current) {
        void handleRefresh()
      }
    }, 1000)

    return (): void => clearInterval(timer)
  }, [])

  // Listen for playback state updates from SpotifyPlayer
  useEffect(() => {
    const handlePlaybackUpdate = (event: CustomEvent<PlaybackInfo>): void => {
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

    return (): void => {
      window.removeEventListener(
        'playbackUpdate',
        handlePlaybackUpdate as EventListener
      )
    }
  }, [])

  // Capture console logs
  useEffect(() => {
    const originalConsoleLog = console.log
    const originalConsoleError = console.error

    const formatArg = (arg: unknown): string => {
      if (arg === null) return 'null'
      if (typeof arg === 'undefined') return 'undefined'
      if (typeof arg === 'string') return arg
      if (typeof arg === 'number') return arg.toString()
      if (typeof arg === 'boolean') return arg.toString()
      if (typeof arg === 'object') {
        try {
          if (arg instanceof Error) return arg.message
          if (arg instanceof Date) return arg.toISOString()
          if (Array.isArray(arg)) return `[Array(${arg.length})]`
          if (arg instanceof Object) {
            const keys = Object.keys(arg)
            return `{${keys.length} keys}`
          }
          return '[Object]'
        } catch {
          return '[Object]'
        }
      }
      if (typeof arg === 'function') return '[Function]'
      if (typeof arg === 'symbol') return arg.toString()
      if (typeof arg === 'bigint') return arg.toString()
      return '[Unknown]'
    }

    console.log = (...args: unknown[]): void => {
      originalConsoleLog(...args)
      setConsoleLogs((prev) => {
        const newLog = args.map(formatArg).join(' ')
        return [...prev.slice(-9), newLog]
      })
    }

    console.error = (...args: unknown[]): void => {
      originalConsoleError(...args)
      setConsoleLogs((prev) => {
        const newLog = args.map(formatArg).join(' ')
        return [...prev.slice(-9), `[ERROR] ${newLog}`]
      })
    }

    return (): void => {
      console.log = originalConsoleLog
      console.error = originalConsoleError
    }
  }, [])

  // Uptime timer
  useEffect(() => {
    const startTime = Date.now()
    const timer = setInterval((): void => {
      setUptime(Date.now() - startTime)
    }, 1000)

    return (): void => clearInterval(timer)
  }, [])

  // Update token info display
  useEffect(() => {
    const updateTokenInfo = async (): Promise<void> => {
      try {
        const response = await fetch('/api/token-info')
        const data = await response.json()
        const now = Date.now()
        const remainingTime = Math.max(0, data.lastRefresh + data.expiresIn - now)
        
        // If this is the first time we're getting token info, set lastActualRefresh
        setTokenInfo((prev) => ({
          ...prev,
          lastRefresh: data.lastRefresh,
          expiresIn: data.expiresIn,
          scope: data.scope,
          type: data.type,
          remainingTime,
          lastActualRefresh: prev.lastActualRefresh || data.lastRefresh
        }))
      } catch (error) {
        console.error('[Token] Failed to fetch token info:', error)
      }
    }

    // Initial update
    if (healthStatus.token === 'valid' || healthStatus.token === 'expired') {
      void updateTokenInfo()
    }

    // Set up interval for regular updates
    const interval = setInterval(() => {
      if (healthStatus.token === 'valid' || healthStatus.token === 'expired') {
        void updateTokenInfo()
      }
    }, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [healthStatus.token])

  // Network connection monitoring
  useEffect(() => {
    const checkConnection = async (): Promise<void> => {
      try {
        const startTime = performance.now()
        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-store'
        })
        const endTime = performance.now()
        const latency = endTime - startTime

        if (!response.ok) {
          throw new Error('Token check failed')
        }

        // Update connection status based on latency
        if (latency < 200) {
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
        } else if (latency < 500) {
          setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
        } else {
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        }
      } catch (error) {
        console.error('[Connection] Token check failed:', error)
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
      }
    }

    // Initial check
    void checkConnection()

    // Set up interval for regular checks
    const interval = setInterval(() => {
      void checkConnection()
    }, DEVICE_CHECK_INTERVAL[healthStatus.connection])

    return () => clearInterval(interval)
  }, [healthStatus.connection])

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = (): void => {
      setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
    }

    const handleOffline = (): void => {
      setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const formatTimeRemaining = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  const formatTimeAgo = (timestamp: number): string => {
    const minutes = Math.floor((Date.now() - timestamp) / 60000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m ago`
  }

  const formatTokenExpiration = (lastRefresh: number, expiresIn: number): string => {
    const expirationTime = lastRefresh + expiresIn
    const now = Date.now()
    const remainingTime = Math.max(0, expirationTime - now)
    const expirationDate = new Date(expirationTime)
    return `${formatTimeRemaining(remainingTime)} (${expirationDate.toLocaleTimeString()})`
  }

  const formatTokenScope = (scope: string): string => {
    return scope
      .split(' ')
      .map((s) => s.replace(/-/g, ' '))
      .join('\n')
  }

  const handlePlayback = async (action: 'play' | 'skip'): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      if (action === 'play') {
        // Get current playback state to determine position
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // If we have a current track in the fixed playlist, resume from that position
        if (
          state?.context?.uri === `spotify:playlist:${fixedPlaylistId}` &&
          state?.item
        ) {
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: state.progress_ms,
              offset: { uri: state.item.uri }
            }
          })
        } else {
          // Otherwise start from the beginning
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`
            }
          })
        }
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
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`
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

  const handleRefresh = async (): Promise<void> => {
    if (isRefreshing.current) {
      return
    }

    try {
      isRefreshing.current = true
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/refresh-site')
      const data = (await response.json()) as RefreshResponse

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to refresh site')
      }

      // Dispatch refresh event for the player to handle
      window.dispatchEvent(new CustomEvent('playlistRefresh'))
      lastRefreshTime.current = Date.now()
    } catch (error) {
      console.error('[Refresh] Failed:', error)
      setError('Failed to refresh site')
    } finally {
      setIsLoading(false)
      isRefreshing.current = false
    }
  }

  return (
    <div className='text-white min-h-screen bg-black p-4'>
      <SpotifyPlayer />

      <div className='mx-auto max-w-xl space-y-4'>
        <h1 className='mb-8 text-2xl font-bold'>Admin Controls</h1>

        {error && (
          <div className='mb-4 rounded border border-red-500 bg-red-900/50 p-4 text-red-100'>
            {error}
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
                healthStatus.token === 'valid'
                  ? 'bg-green-500'
                  : healthStatus.token === 'expired'
                    ? 'bg-yellow-500'
                    : healthStatus.token === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-500'
              }`}
            />
            <span className='font-medium'>
              {healthStatus.token === 'valid'
                ? 'Token Valid'
                : healthStatus.token === 'expired'
                  ? 'Token Expired'
                  : healthStatus.token === 'error'
                    ? 'Token Error'
                    : 'Token Status Unknown'}
            </span>
            {healthStatus.token === 'valid' && (
              <div className='group relative'>
                <div className='invisible absolute left-0 top-0 z-10 rounded-lg bg-gray-800 p-2 text-xs text-gray-200 shadow-lg transition-all duration-200 group-hover:visible'>
                  <div className='whitespace-nowrap'>
                    <div>
                      Token expires: {formatTokenExpiration(tokenInfo.lastRefresh, tokenInfo.expiresIn)}
                    </div>
                    <div>
                      Last token refresh: {formatTokenTime(tokenInfo.lastActualRefresh)}
                    </div>
                    <div className='text-gray-400 text-[10px]'>
                      (Display updates every 30s)
                    </div>
                    <div className='mt-1'>
                      <div className='font-medium'>Permissions:</div>
                      <div className='whitespace-pre'>{formatTokenScope(tokenInfo.scope)}</div>
                    </div>
                  </div>
                </div>
                <svg
                  className='h-4 w-4 text-gray-400'
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
            )}
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
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <div className='text-center text-sm text-gray-400'>
            <div className='flex justify-between'>
              <span>Uptime: {formatTime(uptime)}</span>
              <span>Next auto-refresh in {formatTime(timeUntilRefresh)}</span>
            </div>
          </div>
          <div className='mt-4 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
            <h3 className='mb-2 text-sm font-medium text-gray-400'>
              Recent Console Logs
            </h3>
            <div className='max-h-40 overflow-y-auto font-mono text-xs [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {consoleLogs.map((log, index) => (
                <div key={index} className='py-1'>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
