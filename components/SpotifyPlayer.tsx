'use client'

import { useEffect, useRef } from 'react'
import { useSpotifyPlayerState } from '@/hooks/useSpotifyPlayerState'

export function SpotifyPlayer(): React.ReactElement | null {
  const isMounted = useRef(true)
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
  } = useSpotifyPlayerState()

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
    const interval = deviceId ? setInterval((): void => void refreshPlaylistState(), 5000) : null

    return (): void => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [deviceId, refreshPlaylistState])

  if (error) {
    const retryCount = reconnectAttempts?.current ?? 0
    return (
      <div className="text-red-500">
        <p>Error: {error}</p>
        {retryCount < MAX_RECONNECT_ATTEMPTS && (
          <button
            onClick={(): void => void reconnectPlayer()}
            className="mt-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Retry Connection
          </button>
        )}
      </div>
    )
  }

  return null
}
