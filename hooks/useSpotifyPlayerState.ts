import { useState, useRef, useCallback, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import type { SpotifyPlayerInstance } from '@/types/spotify'
import { debounce } from '@/lib/utils'

// Singleton to track initialization state
let isInitialized = false
let initializationPromise: Promise<void> | null = null
let playerInstance: SpotifyPlayerInstance | null = null

interface UseSpotifyPlayerStateReturn {
  error: string | null
  setError: (error: string | null) => void
  setDeviceId: (deviceId: string | null) => void
  setIsReady: (isReady: boolean) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
  deviceId: string | null
  isMounted: React.RefObject<boolean>
  reconnectAttempts: React.RefObject<number>
  MAX_RECONNECT_ATTEMPTS: number
  initializationCheckInterval: React.RefObject<NodeJS.Timeout | null>
  playlistRefreshInterval: React.RefObject<NodeJS.Timeout | null>
  checkPlayerReady: () => Promise<boolean>
  initializePlayer: () => Promise<void>
  reconnectPlayer: () => Promise<void>
  refreshPlayerState: () => Promise<void>
  refreshPlaylistState: () => Promise<void>
}

export function useSpotifyPlayerState(): UseSpotifyPlayerStateReturn {
  const [error, setError] = useState<string | null>(null)
  const setDeviceId = useSpotifyPlayer((state) => state.setDeviceId)
  const setIsReady = useSpotifyPlayer((state) => state.setIsReady)
  const setPlaybackState = useSpotifyPlayer((state) => state.setPlaybackState)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isMounted = useRef(true)
  const reconnectAttempts = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 3
  const initializationCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const playlistRefreshInterval = useRef<NodeJS.Timeout | null>(null)
  const lastReadyState = useRef<boolean>(false)

  // Track ready state changes
  useEffect(() => {
    const unsubscribe = useSpotifyPlayer.subscribe(
      (state) => {
        if (state.isReady !== lastReadyState.current) {
          console.log('[SpotifyPlayer] Ready state changed:', {
            from: lastReadyState.current,
            to: state.isReady,
            deviceId: state.deviceId,
            playbackState: state.playbackState
          })
          lastReadyState.current = state.isReady
        }
      }
    )
    return () => unsubscribe()
  }, [])

  const checkPlayerReady = useCallback(async (): Promise<boolean> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID in state, checking player state')
      return false
    }

    try {
      // Add a small delay to allow the SDK to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state?.device?.id) {
        console.log('[SpotifyPlayer] No device ID in player state')
        return false
      }

      // If we have a device ID in the state, update our stored device ID
      if (state.device.id !== currentDeviceId) {
        console.log('[SpotifyPlayer] Updating device ID:', {
          from: currentDeviceId,
          to: state.device.id
        })
        setDeviceId(state.device.id)
      }

      // We're ready if we have a valid device ID and the player is active
      const isReady = state.device.is_active
      if (isReady) {
        console.log('[SpotifyPlayer] Player verified as ready')
        setIsReady(true)
      }
      return isReady
    } catch (error) {
      console.error('[SpotifyPlayer] Error checking player ready:', error)
      return false
    }
  }, [setIsReady, setDeviceId])

  const initializePlayer = useCallback(async (): Promise<void> => {
    if (isInitialized && playerInstance) {
      return
    }

    try {
      const response = await fetch('/api/token')
      if (!response.ok) {
        throw new Error('Failed to get Spotify token')
      }
      const { access_token } = await response.json()

      if (!window.Spotify) {
        throw new Error('Spotify SDK not loaded')
      }

      if (playerInstance) {
        return
      }

      const player = new window.Spotify.Player({
        name: 'JM Bar Jukebox',
        getOAuthToken: (cb: (token: string) => void) => {
          cb(access_token)
        },
        volume: 0.5
      })

      // Add a delay before connecting to ensure SDK is fully loaded
      await new Promise(resolve => setTimeout(resolve, 1000))

      const connected = await player.connect()
      if (!connected) {
        throw new Error('Failed to connect to Spotify player')
      }

      playerInstance = player
      window.spotifyPlayerInstance = player
      isInitialized = true

      // Set up event listeners after successful connection
      player.addListener('ready', async ({ device_id }: { device_id: string }) => {
        if (!isMounted.current) return
        console.log('[SpotifyPlayer] Player ready event received, device_id:', device_id)
        setDeviceId(device_id)
        
        // Add a delay before checking ready state
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        try {
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          if (state?.device?.id === device_id && state.device.is_active) {
            console.log('[SpotifyPlayer] Player verified as ready')
            setIsReady(true)
          } else {
            console.log('[SpotifyPlayer] Player not active, attempting to transfer playback')
            await sendApiRequest({
              path: 'me/player',
              method: 'PUT',
              body: {
                device_ids: [device_id],
                play: false
              }
            })
            setIsReady(true)
          }
        } catch (error) {
          console.error('[SpotifyPlayer] Error during ready handler:', error)
          setIsReady(false)
        }
      })

      player.addListener('player_state_changed', (state: SpotifyPlaybackState) => {
        if (!isMounted.current) return
        try {
          console.log('[SpotifyPlayer] State changed:', state)
          setPlaybackState(state)
          if (state?.device?.id) {
            setDeviceId(state.device.id)
            setIsReady(state.device.is_active)
          }
        } catch (error) {
          console.error('[SpotifyPlayer] Error handling state change:', error)
        }
      })

      player.addListener('initialization_error', ({ message }: { message: string }) => {
        if (!isMounted.current) return
        setError(`Failed to initialize: ${message}`)
        setIsReady(false)
      })

      player.addListener('authentication_error', ({ message }: { message: string }) => {
        if (!isMounted.current) return
        setError(`Failed to authenticate: ${message}`)
        setIsReady(false)
      })

      player.addListener('account_error', ({ message }: { message: string }) => {
        if (!isMounted.current) return
        setError(`Failed to validate Spotify account: ${message}`)
        setIsReady(false)
      })

      if (initializationCheckInterval.current) {
        clearInterval(initializationCheckInterval.current)
      }
      initializationCheckInterval.current = setInterval(async () => {
        if (deviceId) {
          const isReady = await checkPlayerReady()
          if (!isReady) {
            await reconnectPlayer()
          } else {
            setIsReady(true)
          }
        }
      }, 10000)
    } catch (_error) {
      if (!isMounted.current) return
      setError(_error instanceof Error ? _error.message : 'Failed to initialize Spotify player')
      setIsReady(false)
    }
  }, [isInitialized, playerInstance, isMounted, setError, setIsReady, checkPlayerReady, deviceId, setDeviceId, setPlaybackState])

  const reconnectPlayer = useCallback(async (): Promise<void> => {
    if (!isMounted.current || reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return

    reconnectAttempts.current++

    try {
      if (playerInstance) {
        await playerInstance.disconnect()
        playerInstance = null
      }

      isInitialized = false
      initializationPromise = null

      await initializePlayer()
      reconnectAttempts.current = 0
    } catch (_error) {
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(reconnectPlayer, 2000)
      } else {
        setError('Failed to reconnect to Spotify player after multiple attempts')
      }
    }
  }, [isMounted, playerInstance, initializePlayer, setError])

  const refreshPlayerState = useCallback(async (): Promise<void> => {
    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id) {
        console.log('[SpotifyPlayer] State changed:', state)
        setPlaybackState(state)
        // If we have a valid device ID and playback state, we're ready
        setIsReady(true)
      }
    } catch (error) {
      console.error('[SpotifyPlayer] Error refreshing player state:', error)
      setIsReady(false)
    }
  }, [setPlaybackState, setIsReady])

  const refreshPlaylistState = useCallback(async (): Promise<void> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID, attempting to reconnect')
      await reconnectPlayer()
      return
    }

    try {
      console.log('[SpotifyPlayer] Starting playlist state refresh')
      console.log('[SpotifyPlayer] Dispatching playlistChecked event')
      window.dispatchEvent(
        new CustomEvent('playlistChecked', {
          detail: {
            timestamp: Date.now(),
            hasChanges: false
          }
        })
      )

      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id === currentDeviceId) {
        console.log('[SpotifyPlayer] Device is active, updating state:', {
          isPlaying: state.is_playing,
          currentTrack: state.item?.name,
          progress: state.progress_ms
        })

        if (state.is_playing && state.context?.uri) {
          console.log('[SpotifyPlayer] Setting up playlist change status handler')

          const hasChanges = await new Promise<boolean>((resolve) => {
            const handler = (e: CustomEvent) => {
              console.log('[SpotifyPlayer] Received playlistChangeStatus response:', e.detail)
              window.removeEventListener('playlistChangeStatus', handler as EventListener)
              resolve(e.detail.hasChanges)
            }
            window.addEventListener('playlistChangeStatus', handler as EventListener)

            console.log('[SpotifyPlayer] Dispatching getPlaylistChangeStatus event')
            const statusEvent = new CustomEvent('getPlaylistChangeStatus')
            window.dispatchEvent(statusEvent)
          })

          if (hasChanges) {
            console.log('[SpotifyPlayer] Reinitializing playback with updated playlist')
            try {
              const currentTrackUri = state.item?.uri
              const currentPosition = state.progress_ms
              const isPlaying = state.is_playing

              await sendApiRequest({
                path: 'me/player/pause',
                method: 'PUT'
              })

              await sendApiRequest({
                path: 'me/player/play',
                method: 'PUT',
                body: {
                  context_uri: state.context.uri,
                  position_ms: currentPosition,
                  offset: { uri: currentTrackUri }
                }
              })

              if (!isPlaying) {
                await sendApiRequest({
                  path: 'me/player/pause',
                  method: 'PUT'
                })
              }

              console.log('[SpotifyPlayer] Playback reinitialized successfully')
            } catch (error) {
              console.error('[SpotifyPlayer] Error reinitializing playback:', error)
            }
          }
        }
      }
    } catch (_error) {
      console.error('[SpotifyPlayer] Error refreshing playlist state:', _error)
      if (_error instanceof Error && 'status' in _error && _error.status === 404) {
        await reconnectPlayer()
      }
    }
  }, [reconnectPlayer])

  const debouncedRefreshPlaylistState = useCallback(
    debounce(async () => {
      await refreshPlaylistState()
    }, 60000), // 1 minute
    [refreshPlaylistState]
  )

  useEffect(() => {
    if (playlistRefreshInterval.current) {
      clearInterval(playlistRefreshInterval.current)
    }

    // Set up the debounced refresh interval
    playlistRefreshInterval.current = setInterval(() => {
      debouncedRefreshPlaylistState()
    }, 10000) // Check every 10 seconds, but actual refresh will be debounced to 1 minute

    return () => {
      if (playlistRefreshInterval.current) {
        clearInterval(playlistRefreshInterval.current)
      }
    }
  }, [debouncedRefreshPlaylistState])

  return {
    error,
    setError,
    setDeviceId,
    setIsReady,
    setPlaybackState,
    deviceId,
    isMounted,
    reconnectAttempts,
    MAX_RECONNECT_ATTEMPTS,
    initializationCheckInterval,
    playlistRefreshInterval,
    checkPlayerReady,
    initializePlayer,
    reconnectPlayer,
    refreshPlayerState,
    refreshPlaylistState
  }
} 