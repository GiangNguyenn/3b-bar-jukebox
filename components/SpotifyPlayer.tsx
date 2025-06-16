'use client'

import { useEffect, useRef, useState } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
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
const MIN_API_CALL_INTERVAL = 2000 // 2 seconds between API calls

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
        : 5000

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
  const { deviceId, isReady, playbackState } = useSpotifyPlayer()
  const [currentTrack, setCurrentTrack] = useState<{
    name: string
    progress: number
    duration: number
  } | null>(null)
  const [localPlaybackStatus, setLocalPlaybackStatus] = useState<
    'playing' | 'paused' | 'stopped'
  >('paused')
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

  // Update interval handling
  useEffect(() => {
    if (!deviceId || !isReady) return

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
      }
    }

    // Set up interval based on playback state
    const interval = setInterval(
      updatePlaybackState,
      localPlaybackStatus === 'playing'
        ? PLAYBACK_INTERVALS.playing
        : PLAYBACK_INTERVALS.paused
    )
    playbackIntervalRef.current = interval

    // Initial update
    void updatePlaybackState()

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
      }
    }
  }, [deviceId, isReady, localPlaybackStatus, playlist?.tracks?.items])

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
      }
      if (localPlaylistRefreshInterval.current) {
        clearInterval(localPlaylistRefreshInterval.current)
      }
    }
  }, [])

  return null
}
