'use client'

import { useState, useEffect, useRef } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import SpotifyPlayer from '@/components/SpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

const REFRESH_INTERVAL = 180000 // 3 minutes in milliseconds
const DEVICE_CHECK_INTERVAL = 10000 // 10 seconds in milliseconds
const MAX_RECOVERY_ATTEMPTS = 3
const RECOVERY_DELAY = 5000 // 5 seconds between recovery attempts
const TOKEN_CHECK_INTERVAL = 300000 // 5 minutes in milliseconds

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected'
  playback: 'playing' | 'paused' | 'stopped' | 'error'
  token: 'valid' | 'expired' | 'error'
  connection: 'good' | 'unstable' | 'poor'
}

interface TokenResponse {
  expires_in: number
}

interface RefreshResponse {
  message?: string
  success: boolean
}

export default function AdminPage(): JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeUntilRefresh, setTimeUntilRefresh] = useState(REFRESH_INTERVAL)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'healthy',
    playback: 'stopped',
    token: 'valid',
    connection: 'good'
  })
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [networkErrorCount, setNetworkErrorCount] = useState(0)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const { fixedPlaylistId } = useFixedPlaylist()
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const lastRefreshTime = useRef<number>(Date.now())
  const lastDeviceCheckTime = useRef<number>(Date.now())
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const tokenCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const responseTimes = useRef<number[]>([])
  const isRefreshing = useRef<boolean>(false)

  // Check token validity
  useEffect(() => {
    const checkToken = async (): Promise<void> => {
      try {
        const response = await fetch('/api/token')
        if (!response.ok) {
          setHealthStatus((prev) => ({ ...prev, token: 'error' }))
          return
        }
        const { expires_in } = await response.json() as TokenResponse

        // If token is about to expire (less than 5 minutes), refresh it
        if (expires_in <= 300) {
          try {
            const refreshResponse = await fetch('/api/refresh-token', {
              method: 'POST'
            })
            if (!refreshResponse.ok) {
              throw new Error('Failed to refresh token')
            }
            console.log('Token refreshed successfully')
            setHealthStatus((prev) => ({ ...prev, token: 'valid' }))
          } catch (error) {
            console.error('Token refresh failed:', error)
            setHealthStatus((prev) => ({ ...prev, token: 'error' }))
          }
        } else {
          setHealthStatus((prev) => ({
            ...prev,
            token: expires_in > 300 ? 'valid' : 'expired'
          }))
        }
      } catch (error) {
        console.error('Token check failed:', error)
        setHealthStatus((prev) => ({ ...prev, token: 'error' }))
      }
    }

    tokenCheckInterval.current = setInterval(() => {
      void checkToken()
    }, TOKEN_CHECK_INTERVAL)
    void checkToken() // Initial check

    return (): void => {
      if (tokenCheckInterval.current) {
        clearInterval(tokenCheckInterval.current)
      }
    }
  }, [])

  // Track response times for connection quality
  const trackResponseTime = async <T,>(operation: () => Promise<T>): Promise<void> => {
    const start = performance.now()
    try {
      await operation()
      const end = performance.now()
      responseTimes.current.push(end - start)
      if (responseTimes.current.length > 5) {
        responseTimes.current.shift()
      }
      const avgResponseTime =
        responseTimes.current.reduce((a, b) => a + b, 0) /
        responseTimes.current.length
      setHealthStatus((prev) => ({
        ...prev,
        connection:
          avgResponseTime < 500
            ? 'good'
            : avgResponseTime < 1000
              ? 'unstable'
              : 'poor'
      }))
    } catch (error) {
      console.error('Response time tracking failed:', error)
      setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
    }
  }

  // Device health check and recovery
  useEffect(() => {
    const checkDeviceHealth = async (): Promise<void> => {
      if (!deviceId) {
        setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
        return
      }

      await trackResponseTime(async () => {
        // Use our backend endpoint instead of direct Spotify API call
        const response = await fetch('/api/playback-state')
        if (!response.ok) {
          throw new Error('Failed to get playback state')
        }
        const state = await response.json() as SpotifyPlaybackState

        if (!state?.device?.id) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          return
        }

        if (state.device.id !== deviceId) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          return
        }

        // Update playback status
        setHealthStatus((prev) => ({
          ...prev,
          device: 'healthy',
          playback: state.is_playing
            ? 'playing'
            : state.item
              ? 'paused'
              : 'stopped'
        }))
        lastDeviceCheckTime.current = Date.now()
      })
    }

    deviceCheckInterval.current = setInterval(() => {
      void checkDeviceHealth()
    }, DEVICE_CHECK_INTERVAL)

    return (): void => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
    }
  }, [deviceId])

  // Device health check and recovery
  useEffect(() => {
    const attemptRecovery = async (): Promise<void> => {
      if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
        console.log('Max recovery attempts reached, giving up')
        return
      }

      try {
        console.log(
          `Attempting device recovery (attempt ${recoveryAttempts + 1}/${MAX_RECOVERY_ATTEMPTS})`
        )

        // First, try to transfer playback to our device
        if (deviceId) {
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [deviceId],
              play: false
            }
          })
        }

        // Then refresh the player state
        if (typeof window.refreshSpotifyPlayer === 'function') {
          await window.refreshSpotifyPlayer()
        }

        // Check if recovery was successful
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (state?.device?.id === deviceId) {
          console.log('Device recovery successful')
          setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
          setRecoveryAttempts(0)
          return
        }

        // If recovery failed, schedule next attempt
        setRecoveryAttempts((prev) => prev + 1)
        recoveryTimeout.current = setTimeout(() => {
          void attemptRecovery()
        }, RECOVERY_DELAY)
      } catch (error) {
        console.error('Recovery attempt failed:', error)
        setRecoveryAttempts((prev) => prev + 1)
        recoveryTimeout.current = setTimeout(() => {
          void attemptRecovery()
        }, RECOVERY_DELAY)
      }
    }

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
        console.error('Device health check failed:', error)
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      }
    }

    deviceCheckInterval.current = setInterval(() => {
      void checkDeviceHealth()
    }, DEVICE_CHECK_INTERVAL)

    return (): void => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [deviceId, recoveryAttempts])

  // Request wake lock to prevent device sleep
  useEffect(() => {
    const requestWakeLock = async (): Promise<void> => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen')
          console.log('Wake Lock is active')
        }
      } catch (error) {
        console.error('Failed to request wake lock:', error)
      }
    }

    void requestWakeLock()

    return (): void => {
      if (wakeLock.current) {
        void wakeLock.current.release()
      }
    }
  }, [])

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

  // Automatic periodic refresh every 2 minutes
  useEffect(() => {
    const refreshInterval = setInterval((): void => {
      if (!isLoading) {
        // Don't refresh if already loading
        void (async (): Promise<void> => {
          try {
            setIsLoading(true)
            const response = await fetch('/api/refresh-site')
            const data = await response.json() as RefreshResponse

            if (!response.ok) {
              console.error(
                'Auto refresh failed:',
                data.message ?? 'Failed to refresh site'
              )
              return
            }

            // Dispatch refresh event for the player to handle
            window.dispatchEvent(new CustomEvent('playlistRefresh'))
            console.log('Auto refresh completed successfully')
            lastRefreshTime.current = Date.now()
          } catch (err) {
            console.error('Auto refresh error:', err)
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
        console.error('Network recovery failed:', error)
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

      setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
    } catch (error) {
      console.error('Playback control failed:', error)
      setError('Failed to control playback')
      setHealthStatus((prev) => ({ ...prev, playback: 'error' }))
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

      if (typeof window.refreshSpotifyPlayer === 'function') {
        await window.refreshSpotifyPlayer()
      }

      setTimeUntilRefresh(REFRESH_INTERVAL)
      lastRefreshTime.current = Date.now()
    } catch (error) {
      console.error('Refresh failed:', error)
      setError('Failed to refresh player')
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
            className={`h-3 w-3 rounded-full ${isReady ? 'animate-pulse bg-green-500' : 'bg-yellow-500'}`}
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
                    : 'bg-red-500'
              }`}
            />
            <span className='font-medium'>
              {healthStatus.device === 'healthy'
                ? 'Device Connected'
                : healthStatus.device === 'unresponsive'
                  ? 'Device Unresponsive'
                  : 'Device Disconnected'}
              {recoveryAttempts > 0 &&
                ` (Recovery ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})`}
            </span>
          </div>

          <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
            <div
              className={`h-3 w-3 rounded-full ${
                healthStatus.playback === 'playing'
                  ? 'bg-green-500'
                  : healthStatus.playback === 'paused'
                    ? 'bg-yellow-500'
                    : healthStatus.playback === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-500'
              }`}
            />
            <span className='font-medium'>
              {healthStatus.playback === 'playing'
                ? 'Playback Active'
                : healthStatus.playback === 'paused'
                  ? 'Playback Paused'
                  : healthStatus.playback === 'error'
                    ? 'Playback Error'
                    : 'Playback Stopped'}
            </span>
          </div>

          <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
            <div
              className={`h-3 w-3 rounded-full ${
                healthStatus.token === 'valid'
                  ? 'bg-green-500'
                  : healthStatus.token === 'expired'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
            />
            <span className='font-medium'>
              {healthStatus.token === 'valid'
                ? 'Token Valid'
                : healthStatus.token === 'expired'
                  ? 'Token Expiring'
                  : 'Token Error'}
            </span>
          </div>

          <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
            <div
              className={`h-3 w-3 rounded-full ${
                healthStatus.connection === 'good'
                  ? 'bg-green-500'
                  : healthStatus.connection === 'unstable'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
            />
            <span className='font-medium'>
              {healthStatus.connection === 'good'
                ? 'Connection Good'
                : healthStatus.connection === 'unstable'
                  ? 'Connection Unstable'
                  : 'Connection Poor'}
            </span>
          </div>
        </div>

        <div className='flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
          <div className='h-3 w-3 animate-pulse rounded-full bg-blue-500' />
          <span className='font-medium'>
            Next refresh in: {formatTime(timeUntilRefresh)}
          </span>
        </div>

        <div className='flex gap-4'>
          <button
            onClick={() => void handlePlayback('play')}
            disabled={isLoading || !deviceId || !isReady || !fixedPlaylistId}
            className={`flex-1 rounded px-6 py-3 font-semibold ${
              isLoading || !deviceId || !isReady || !fixedPlaylistId
                ? 'cursor-not-allowed bg-green-900/30 text-green-100/50'
                : 'bg-green-600 hover:bg-green-500 active:bg-green-700'
            } `}
          >
            {isLoading ? 'Loading...' : 'Play'}
          </button>

          <button
            onClick={() => void handlePlayback('skip')}
            disabled={isLoading || !deviceId || !isReady}
            className={`flex-1 rounded px-6 py-3 font-semibold ${
              isLoading || !deviceId || !isReady
                ? 'cursor-not-allowed bg-red-900/30 text-red-100/50'
                : 'bg-red-600 hover:bg-red-500 active:bg-red-700'
            } `}
          >
            {isLoading ? 'Loading...' : 'Skip'}
          </button>

          <button
            onClick={() => void handleRefresh()}
            disabled={isLoading}
            className={`flex-1 rounded px-6 py-3 font-semibold ${
              isLoading
                ? 'cursor-not-allowed bg-blue-900/30 text-blue-100/50'
                : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700'
            } `}
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  )
}
