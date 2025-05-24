'use client'

import { useEffect, useRef, useState } from 'react'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

const PLAYBACK_INTERVALS = {
  playing: 10000, // 10 seconds when playing
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

export function SpotifyPlayer(): JSX.Element | null {
  const { fixedPlaylistId } = useFixedPlaylist()
  const { data: playlist } = useGetPlaylist(fixedPlaylistId ?? '')
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
  >('paused')
  const [isInitialized, setIsInitialized] = useState(false)
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const localPlaylistRefreshInterval = useRef<NodeJS.Timeout | null>(null)
  const lastProgressRef = useRef<number | null>(null)
  const hasConfirmedPlayingRef = useRef(false)

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
      await new Promise((resolve) => setTimeout(resolve, INITIALIZATION_DELAY))
      const tryInitialize = async (): Promise<void> => {
        try {
          await globalRateLimitedApiCall(() => initializePlayer())
          setIsInitialized(true)
          clearTimeout(initTimeout)
        } catch (error) {
          console.error('[SpotifyPlayer] Initialization attempt failed:', error)
          await new Promise((resolve) =>
            setTimeout(resolve, INITIALIZATION_RETRY_DELAY)
          )
        }
      }
      void tryInitialize()
    }
    void initializeWithDelay()
    return (): void => {
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
          // If no state, dispatch stopped state
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                is_playing: false,
                item: null,
                progress_ms: 0,
                device: null,
                remainingTracks: 0
              }
            })
          )
          return
        }

        const currentProgress = state.progress_ms ?? 0

        // Check if progress is changing
        let isActuallyPlaying = false
        if (state.is_playing && hasConfirmedPlayingRef.current) {
          if (currentProgress > lastProgressRef.current!) {
            // Progress has increased, definitely playing
            isActuallyPlaying = true
          } else {
            // Progress hasn't changed, not playing
            isActuallyPlaying = false
            hasConfirmedPlayingRef.current = false
          }
        } else if (state.is_playing && !hasConfirmedPlayingRef.current) {
          if (lastProgressRef.current === null) {
            // First check, store progress and wait for next check
            lastProgressRef.current = currentProgress
          } else if (currentProgress > lastProgressRef.current) {
            // Progress has increased, confirm playing
            isActuallyPlaying = true
            hasConfirmedPlayingRef.current = true
          }
        } else {
          // Not playing according to API
          isActuallyPlaying = false
          hasConfirmedPlayingRef.current = false
        }

        lastProgressRef.current = currentProgress

        // Always update local playback status based on actual state
        const newPlaybackState = isActuallyPlaying ? 'playing' : 'paused'
        if (newPlaybackState !== localPlaybackStatus) {
          setLocalPlaybackStatus(newPlaybackState)
        }

        if (state.item) {
          // Update current track info
          setCurrentTrack({
            name: state.item.name,
            progress: currentProgress,
            duration: state.item.duration_ms
          })

          // Calculate remaining tracks using playlist data
          let remainingTracks = 0
          if (playlist?.tracks?.items) {
            const currentTrackIndex = playlist.tracks.items.findIndex(
              (t) => t.track.id === state.item?.id
            )
            remainingTracks =
              currentTrackIndex >= 0
                ? playlist.tracks.items.length - (currentTrackIndex + 1)
                : playlist.tracks.items.length
          }

          // Dispatch the complete state object with remaining tracks
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                ...state,
                is_playing: isActuallyPlaying,
                remainingTracks
              }
            })
          )
        } else {
          setCurrentTrack(null)
          // Dispatch empty state when no track is playing
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                is_playing: false,
                item: null,
                progress_ms: 0,
                device: state.device,
                remainingTracks: 0
              }
            })
          )
        }
      } catch (error) {
        console.error('[SpotifyPlayer] Error updating playback state:', error)
        // On error, dispatch stopped state
        window.dispatchEvent(
          new CustomEvent('playbackUpdate', {
            detail: {
              is_playing: false,
              item: null,
              progress_ms: 0,
              device: null,
              remainingTracks: 0
            }
          })
        )
      }
    }

    // Initial state update with delay
    const initialUpdateTimeout = setTimeout(() => {
      void updatePlaybackState()
    }, INITIALIZATION_DELAY)

    // Clear any existing interval
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current)
    }

    // Set up interval based on current playback state
    playbackIntervalRef.current = setInterval(() => {
      void updatePlaybackState()
    }, PLAYBACK_INTERVALS[localPlaybackStatus])

    return (): void => {
      clearTimeout(initialUpdateTimeout)
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
    }
  }, [deviceId, localPlaybackStatus, isInitialized, playlist])

  // Update the interval logic to use the local ref
  useEffect(() => {
    if (localPlaylistRefreshInterval.current) {
      clearInterval(localPlaylistRefreshInterval.current)
    }

    localPlaylistRefreshInterval.current = setInterval(() => {
      void refreshPlaylistState()
    }, 60000) // Refresh every minute

    return (): void => {
      if (localPlaylistRefreshInterval.current) {
        clearInterval(localPlaylistRefreshInterval.current)
        localPlaylistRefreshInterval.current = null
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
