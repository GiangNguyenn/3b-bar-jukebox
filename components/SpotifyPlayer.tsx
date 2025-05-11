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

export function SpotifyPlayer(): React.ReactElement | null {
  const { fixedPlaylistId } = useFixedPlaylist()
  const {
    error,
    deviceId,
    reconnectAttempts,
    MAX_RECONNECT_ATTEMPTS,
    initializePlayer,
    reconnectPlayer
  } = useSpotifyPlayerState(fixedPlaylistId ?? '')
  const [playbackState, setPlaybackState] = useState<
    'playing' | 'paused' | 'stopped'
  >('stopped')
  const [currentTrack, setCurrentTrack] = useState<{
    name: string
    progress: number
    duration: number
  } | null>(null)
  const hasInitialized = useRef(false)
  const initAttempts = useRef(0)
  const MAX_INIT_ATTEMPTS = 3

  // Handle SDK initialization
  useEffect(() => {
    if (hasInitialized.current) {
      console.log('[SpotifyPlayer] Already initialized, skipping')
      return
    }

    const handleSDKReady = async (): Promise<void> => {
      if (hasInitialized.current) {
        console.log('[SpotifyPlayer] Already initialized, skipping')
        return
      }

      if (initAttempts.current >= MAX_INIT_ATTEMPTS) {
        console.error('[SpotifyPlayer] Max initialization attempts reached')
        return
      }

      try {
        console.log(
          '[SpotifyPlayer] Starting initialization attempt',
          initAttempts.current + 1
        )
        initAttempts.current++

        // Ensure SDK is actually ready
        if (!window.Spotify) {
          console.error('[SpotifyPlayer] SDK not available despite ready event')
          return
        }

        await initializePlayer()
        hasInitialized.current = true
        console.log('[SpotifyPlayer] Initialization successful')
        window.dispatchEvent(new CustomEvent('playerReady'))
      } catch (error) {
        console.error('[SpotifyPlayer] Error during initialization:', error)
        // Reset initialization state on error
        hasInitialized.current = false

        // Try again after a delay if we haven't hit max attempts
        if (initAttempts.current < MAX_INIT_ATTEMPTS) {
          const delay = Math.pow(2, initAttempts.current) * 1000 // Exponential backoff
          console.log(`[SpotifyPlayer] Retrying initialization in ${delay}ms`)
          setTimeout(() => {
            void handleSDKReady()
          }, delay)
        }
      }
    }

    // Check if SDK is already ready
    if (window.Spotify) {
      console.log('[SpotifyPlayer] SDK already ready, starting initialization')
      void handleSDKReady()
    } else {
      console.log('[SpotifyPlayer] Waiting for SDK ready event')
      window.addEventListener('spotifySDKReady', () => void handleSDKReady())
    }

    return () => {
      window.removeEventListener('spotifySDKReady', () => void handleSDKReady())
    }
  }, [initializePlayer])

  // Handle playback state updates
  useEffect(() => {
    if (!deviceId) return

    const updatePlaybackState = async (): Promise<void> => {
      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!state) {
          console.log('[SpotifyPlayer] No playback state available')
          return
        }

        if (state.item) {
          const timeUntilEnd = state.item.duration_ms - (state.progress_ms ?? 0)
          const newPlaybackState = state.is_playing ? 'playing' : 'paused'

          if (newPlaybackState !== playbackState) {
            setPlaybackState(newPlaybackState)
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
          if (playbackState !== 'stopped') {
            setPlaybackState('stopped')
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

    // Initial state update
    void updatePlaybackState()

    // Set up interval based on current playback state
    const interval = setInterval(() => {
      void updatePlaybackState()
    }, PLAYBACK_INTERVALS[playbackState])

    return () => {
      clearInterval(interval)
    }
  }, [deviceId, playbackState])

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

  return null
}
