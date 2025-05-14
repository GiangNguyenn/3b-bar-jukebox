'use client'

import { useEffect, useRef, useState } from 'react'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

const PLAYBACK_INTERVALS = {
  playing: 10000, // 10 seconds when playing (changed from 5)
  paused: 30000, // 30 seconds when paused
  stopped: 60000 // 60 seconds when stopped
}

// Update initialization constants
const INITIALIZATION_DELAY = 5000 // 5 seconds before first initialization attempt
const INITIALIZATION_RETRY_DELAY = 5000 // 5 seconds between retries
const MIN_API_CALL_INTERVAL = 2000 // 2 seconds between API calls
const INITIALIZATION_TIMEOUT = 30000 // 30 seconds max initialization time

// Global rate limit tracker
const globalRateLimitInfo = {
  lastApiCall: 0,
  nextAllowedCall: 0,
  isRateLimited: false
}

// Add rate limit tracking interface
interface RateLimitInfo {
  lastRateLimitHit: number | null
  retryAfter: number | null
  nextAllowedCall: number | null
}

// Add a global rate-limited API call function
async function globalRateLimitedApiCall<T>(
  apiCall: () => Promise<T>
): Promise<T> {
  const now = Date.now()

  // Check if we're rate limited
  if (
    globalRateLimitInfo.isRateLimited &&
    now < globalRateLimitInfo.nextAllowedCall
  ) {
    const timeUntilAllowed = Math.ceil(
      (globalRateLimitInfo.nextAllowedCall - now) / 1000
    )
    console.log(`[Global Rate Limit] Waiting ${timeUntilAllowed} seconds`)
    await new Promise((resolve) => setTimeout(resolve, timeUntilAllowed * 1000))
  }

  // Ensure minimum interval between calls
  const timeSinceLastCall = now - globalRateLimitInfo.lastApiCall
  if (timeSinceLastCall < MIN_API_CALL_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_API_CALL_INTERVAL - timeSinceLastCall)
    )
  }

  try {
    globalRateLimitInfo.lastApiCall = Date.now()
    return await apiCall()
  } catch (error) {
    if (error instanceof Error && error.message.includes('429')) {
      const retryAfter = error.message.includes('Retry-After')
        ? parseInt(error.message.split('Retry-After: ')[1]) * 1000
        : INITIALIZATION_RETRY_DELAY

      globalRateLimitInfo.isRateLimited = true
      globalRateLimitInfo.nextAllowedCall = Date.now() + retryAfter

      console.log('[Global Rate Limit] Rate limit hit:', {
        retryAfter: `${retryAfter / 1000} seconds`,
        nextAllowedCall: new Date(
          globalRateLimitInfo.nextAllowedCall
        ).toISOString()
      })

      await new Promise((resolve) => setTimeout(resolve, retryAfter))
      return apiCall()
    }
    throw error
  }
}

export function SpotifyPlayer(): React.ReactElement | null {
  const { fixedPlaylistId } = useFixedPlaylist()
  const {
    error,
    deviceId,
    isReady,
    reconnectAttempts,
    MAX_RECONNECT_ATTEMPTS,
    initializePlayer,
    reconnectPlayer,
    refreshPlaylistState
  } = useSpotifyPlayerState(fixedPlaylistId ?? '')
  const [currentTrack, setCurrentTrack] = useState<{
    name: string
    progress: number
    duration: number
  } | null>(null)
  const [localPlaybackStatus, setLocalPlaybackStatus] = useState<
    'playing' | 'paused' | 'stopped'
  >('stopped')
  const [isInitialized, setIsInitialized] = useState(false)
  const [intervalId, setIntervalId] = useState<ReturnType<
    typeof setInterval
  > | null>(null)
  const localPlaylistRefreshInterval = useRef<NodeJS.Timeout | null>(null)

  // Add rate limit state inside component
  const [rateLimitInfo] = useState<RateLimitInfo>({
    lastRateLimitHit: null,
    retryAfter: null,
    nextAllowedCall: null
  })

  // Handle SDK initialization
  useEffect(() => {
    const initTimeout = setTimeout(() => {
      console.log(
        '[SpotifyPlayer] Forcing initialization complete after timeout'
      )
      setIsInitialized(true)
    }, INITIALIZATION_TIMEOUT)

    const initializeWithDelay = async (): Promise<void> => {
      console.log('[SpotifyPlayer] Starting initialization with delay')

      // Add initial delay before any API calls
      await new Promise((resolve) => setTimeout(resolve, INITIALIZATION_DELAY))

      const tryInitialize = async (): Promise<void> => {
        try {
          await globalRateLimitedApiCall(() => initializePlayer())
          setIsInitialized(true)
        } catch (error) {
          console.error('[SpotifyPlayer] Initialization attempt failed:', error)
          await new Promise((resolve) =>
            setTimeout(resolve, INITIALIZATION_RETRY_DELAY)
          )
        }
      }

      void tryInitialize()
    }

    // Start initialization
    void initializeWithDelay()

    return () => {
      clearTimeout(initTimeout)
    }
  }, [initializePlayer])

  // Update interval handling
  useEffect(() => {
    if (!deviceId || !isInitialized) return

    const updatePlaybackState = async (): Promise<void> => {
      try {
        const state = await globalRateLimitedApiCall(() =>
          sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET',
            debounceTime: MIN_API_CALL_INTERVAL
          })
        )

        if (!state) {
          console.log('[SpotifyPlayer] No playback state available')
          return
        }

        if (state.item) {
          const timeUntilEnd = state.item.duration_ms - (state.progress_ms ?? 0)
          const newPlaybackState = state.is_playing ? 'playing' : 'paused'

          if (newPlaybackState !== localPlaybackStatus) {
            setLocalPlaybackStatus(newPlaybackState)
          }

          // Update current track info
          setCurrentTrack({
            name: state.item.name,
            progress: state.progress_ms ?? 0,
            duration: state.item.duration_ms
          })

          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                isPlaying: state.is_playing,
                currentTrack: state.item.name,
                progress: state.progress_ms ?? 0,
                duration_ms: state.item.duration_ms,
                timeUntilEnd
              }
            })
          )
        } else {
          if (localPlaybackStatus !== 'stopped') {
            setLocalPlaybackStatus('stopped')
          }
          setCurrentTrack(null)
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                isPlaying: false,
                currentTrack: '',
                progress: 0,
                duration_ms: 0,
                timeUntilEnd: 0
              }
            })
          )
        }
      } catch (error) {
        console.error('[SpotifyPlayer] Error updating playback state:', error)
      }
    }

    // Initial state update with delay
    const initialUpdateTimeout = setTimeout(() => {
      void updatePlaybackState()
    }, INITIALIZATION_DELAY)

    // Set up interval based on current playback state
    const newInterval = setInterval(() => {
      void updatePlaybackState()
    }, PLAYBACK_INTERVALS[localPlaybackStatus])

    // Store interval ID in state
    setIntervalId(newInterval)

    return () => {
      clearTimeout(initialUpdateTimeout)
      if (intervalId) {
        clearInterval(intervalId)
        setIntervalId(null)
      }
    }
  }, [deviceId, localPlaybackStatus, isInitialized, intervalId])

  // Update the interval logic to use the local ref
  useEffect(() => {
    if (localPlaylistRefreshInterval.current) {
      clearInterval(localPlaylistRefreshInterval.current)
    }

    const interval = setInterval(() => {
      void refreshPlaylistState()
    }, PLAYBACK_INTERVALS.stopped) // Default to stopped interval

    localPlaylistRefreshInterval.current = interval

    return () => {
      if (localPlaylistRefreshInterval.current) {
        clearInterval(localPlaylistRefreshInterval.current)
      }
    }
  }, [refreshPlaylistState])

  // Add a new effect to handle device ID changes
  useEffect(() => {
    const handleDeviceIdChange = (): void => {
      if (deviceId) {
        console.log('[SpotifyPlayer] Device ID set:', {
          deviceId,
          isReady,
          timestamp: new Date().toISOString()
        })
      }
    }

    handleDeviceIdChange()
  }, [deviceId, isReady])

  if (error) {
    const retryCount = reconnectAttempts?.current ?? 0
    return (
      <div className='text-red-500'>
        <p>Error: {error}</p>
        {retryCount < MAX_RECONNECT_ATTEMPTS && (
          <button
            onClick={(): void => void reconnectPlayer()}
            className='text-white mt-2 rounded bg-red-500 px-4 py-2 hover:bg-red-600'
          >
            Retry Connection
          </button>
        )}
      </div>
    )
  }

  if (!currentTrack) {
    return null
  }

  // Add rate limit status display
  if (rateLimitInfo.lastRateLimitHit) {
    const timeUntilAllowed = rateLimitInfo.nextAllowedCall
      ? Math.ceil((rateLimitInfo.nextAllowedCall - Date.now()) / 1000)
      : 0

    if (timeUntilAllowed > 0) {
      return (
        <div className='p-4 text-yellow-500'>
          <p>Rate limited by Spotify</p>
          <p>Next allowed call in: {timeUntilAllowed} seconds</p>
          <p>
            Last rate limit hit:{' '}
            {new Date(rateLimitInfo.lastRateLimitHit).toLocaleTimeString()}
          </p>
        </div>
      )
    }
  }

  return null
}
