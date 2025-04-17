'use client'

import { useEffect, useRef, useState } from 'react'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

const PLAYBACK_INTERVALS = {
  playing: 15000, // 15 seconds when playing
  paused: 30000, // 30 seconds when paused
  stopped: 60000 // 60 seconds when stopped
}

export function SpotifyPlayer(): React.ReactElement | null {
  const isMounted = useRef(true)
  const { fixedPlaylistId } = useFixedPlaylist()
  const {
    error,
    deviceId,
    reconnectAttempts,
    MAX_RECONNECT_ATTEMPTS,
    initializationCheckInterval,
    playlistRefreshInterval,
    initializePlayer,
    reconnectPlayer,
    refreshPlaylistState
  } = useSpotifyPlayerState(fixedPlaylistId ?? '')
  const [playbackState, setPlaybackState] = useState<
    'playing' | 'paused' | 'stopped'
  >('stopped')

  useEffect(() => {
    isMounted.current = true
    const currentInitInterval = initializationCheckInterval.current
    const currentPlaylistInterval = playlistRefreshInterval.current

    const initialize = async (): Promise<void> => {
      try {
        await initializePlayer()
      } catch (error) {
        console.error('[SpotifyPlayer] Error during initialization:', error)
      }
    }

    void initialize()

    return (): void => {
      isMounted.current = false
      if (currentInitInterval) {
        clearInterval(currentInitInterval)
      }
      if (currentPlaylistInterval) {
        clearInterval(currentPlaylistInterval)
      }
    }
  }, [initializePlayer, initializationCheckInterval, playlistRefreshInterval])

  useEffect(() => {
    if (!deviceId) return

    const updatePlaybackState = async (): Promise<void> => {
      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (state?.is_playing) {
          setPlaybackState('playing')
          // Dispatch playback update event
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                isPlaying: true,
                currentTrack: state.item?.name ?? '',
                progress: state.progress_ms ?? 0
              }
            })
          )
        } else if (state?.item) {
          setPlaybackState('paused')
          // Dispatch playback update event
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                isPlaying: false,
                currentTrack: state.item.name,
                progress: state.progress_ms ?? 0
              }
            })
          )
        } else {
          setPlaybackState('stopped')
          // Dispatch playback update event
          window.dispatchEvent(
            new CustomEvent('playbackUpdate', {
              detail: {
                isPlaying: false,
                currentTrack: '',
                progress: 0
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
      void refreshPlaylistState()
    }, PLAYBACK_INTERVALS[playbackState])

    return (): void => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [deviceId, refreshPlaylistState, playbackState])

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

  return null
}
