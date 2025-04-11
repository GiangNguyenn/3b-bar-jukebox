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
const REFRESH_DEBOUNCE = 5000 // 5 seconds debounce time

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected'
  playback: 'playing' | 'paused' | 'stopped' | 'error'
  token: 'valid' | 'expired' | 'error'
  connection: 'good' | 'unstable' | 'poor'
}

export default function AdminPage() {
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
  const playbackState = useSpotifyPlayer((state) => state.playbackState)
  const { fixedPlaylistId } = useFixedPlaylist()
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const lastRefreshTime = useRef<number>(Date.now())
  const lastDeviceCheckTime = useRef<number>(Date.now())
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const tokenCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const responseTimes = useRef<number[]>([])
  const refreshTimeout = useRef<NodeJS.Timeout | null>(null)
  const isRefreshing = useRef<boolean>(false)

  // Check token validity
  useEffect(() => {
    const checkToken = async () => {
      try {
        const response = await fetch('/api/token')
        if (!response.ok) {
          setHealthStatus((prev) => ({ ...prev, token: 'error' }))
          return
        }
        const { expires_in } = await response.json()

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

    tokenCheckInterval.current = setInterval(checkToken, TOKEN_CHECK_INTERVAL)
    checkToken() // Initial check

    return () => {
      if (tokenCheckInterval.current) {
        clearInterval(tokenCheckInterval.current)
      }
    }
  }, [])

  // Track response times for connection quality
  const trackResponseTime = async (operation: () => Promise<any>) => {
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
      setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
    }
  }

  // Device health check and recovery
  useEffect(() => {
    const checkDeviceHealth = async () => {
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
        const state = await response.json()

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

    // Start periodic checks
    deviceCheckInterval.current = setInterval(
      checkDeviceHealth,
      DEVICE_CHECK_INTERVAL
    )

    return () => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
    }
  }, [deviceId])

  // Device health check and recovery
  useEffect(() => {
    const attemptRecovery = async () => {
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
        recoveryTimeout.current = setTimeout(attemptRecovery, RECOVERY_DELAY)
      } catch (error) {
        console.error('Recovery attempt failed:', error)
        setRecoveryAttempts((prev) => prev + 1)
        recoveryTimeout.current = setTimeout(attemptRecovery, RECOVERY_DELAY)
      }
    }

    const checkDeviceHealth = async () => {
      if (!deviceId) {
        setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
        attemptRecovery()
        return
      }

      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!state?.device?.id) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          attemptRecovery()
          return
        }

        if (state.device.id !== deviceId) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          attemptRecovery()
          return
        }

        // If we got a response and the device matches, it's healthy
        setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
        setRecoveryAttempts(0)
        lastDeviceCheckTime.current = Date.now()
      } catch (error) {
        // If we can't get a response, check if it's been too long
        const timeSinceLastCheck = Date.now() - lastDeviceCheckTime.current
        if (timeSinceLastCheck > DEVICE_CHECK_INTERVAL * 3) {
          setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
          attemptRecovery()
        }
      }
    }

    // Start periodic checks
    deviceCheckInterval.current = setInterval(
      checkDeviceHealth,
      DEVICE_CHECK_INTERVAL
    )

    return () => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [deviceId, recoveryAttempts])

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
        wakeLock.current.release().then(() => {
          wakeLock.current = null
          console.log('Screen can now sleep')
        })
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
        handleRefresh()
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  // Automatic periodic refresh every 2 minutes
  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      if (!isLoading) {
        // Don't refresh if already loading
        try {
          setIsLoading(true)
          const response = await fetch('/api/refresh-site')
          const data = await response.json()

          if (!response.ok) {
            console.error(
              'Auto refresh failed:',
              data.message || 'Failed to refresh site'
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
      }
    }, REFRESH_INTERVAL)

    return () => clearInterval(refreshInterval)
  }, [isLoading])

  // Network error recovery
  useEffect(() => {
    const attemptNetworkRecovery = async () => {
      if (networkErrorCount >= 3) {
        console.log('Max network recovery attempts reached, giving up')
        return
      }

      try {
        console.log(
          `Attempting network recovery (attempt ${networkErrorCount + 1}/3)`
        )

        // Try to refresh the token first
        const tokenResponse = await fetch('/api/token')
        if (!tokenResponse.ok) {
          throw new Error('Token refresh failed')
        }

        // Then try to get playback state
        const stateResponse = await fetch('/api/playback-state')
        if (!stateResponse.ok) {
          throw new Error('Playback state check failed')
        }

        // If both succeeded, reset error state
        setError(null)
        setNetworkErrorCount(0)
        setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
        console.log('Network recovery successful')
      } catch (error) {
        console.error('Network recovery attempt failed:', error)
        setNetworkErrorCount((prev) => prev + 1)
        // Schedule next attempt after 5 seconds
        setTimeout(attemptNetworkRecovery, 5000)
      }
    }

    // If we have a network error, start recovery process
    if (
      error?.includes('Network error') ||
      error?.includes('Failed to fetch')
    ) {
      attemptNetworkRecovery()
    }
  }, [error, networkErrorCount])

  const formatTime = (ms: number) => {
    const seconds = Math.ceil(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

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
      const currentState = await fetch('/api/playback-state').then((res) =>
        res.json()
      )
      const currentTrack = currentState?.item?.uri
      const position_ms = currentState?.progress_ms || 0

      const response = await fetch('/api/playback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action,
          deviceId,
          // Only send contextUri if we don't have a current track to resume from
          contextUri:
            action === 'play' && !currentTrack
              ? `spotify:playlist:${fixedPlaylistId}`
              : undefined,
          position_ms: action === 'play' ? position_ms : undefined,
          offset:
            action === 'play' && currentTrack
              ? { uri: currentTrack }
              : undefined
        })
      })

      if (!response.ok) {
        const data = await response.json()
        // Special handling for the case where music is playing on another device
        if (response.status === 409) {
          setError(
            `${data.error}${data.details ? ` (${data.details.currentDevice}: ${data.details.currentTrack})` : ''}`
          )
          return
        }
        throw new Error(data.error ?? 'Failed to control playback')
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to control playback'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleRefresh = async () => {
    // Prevent multiple simultaneous refreshes
    if (isRefreshing.current) {
      console.log('Refresh already in progress, skipping')
      return
    }

    try {
      isRefreshing.current = true
      setIsLoading(true)
      setError(null)

      // Clear any pending refresh timeout
      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current)
        refreshTimeout.current = null
      }

      const response = await fetch('/api/refresh-site')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to refresh site')
      }

      // Dispatch refresh event for the player to handle
      window.dispatchEvent(new CustomEvent('playlistRefresh'))
      lastRefreshTime.current = Date.now()
      setTimeUntilRefresh(REFRESH_INTERVAL) // Reset the timer
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh site')
    } finally {
      setIsLoading(false)
      // Add a small delay before allowing the next refresh
      refreshTimeout.current = setTimeout(() => {
        isRefreshing.current = false
      }, REFRESH_DEBOUNCE)
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
            onClick={() => handlePlayback('play')}
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
            onClick={() => handlePlayback('skip')}
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
            onClick={handleRefresh}
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
