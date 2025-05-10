import { useState, useRef, useCallback, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, TokenInfo } from '@/shared/types'
import type { SpotifyPlayerInstance } from '@/types/spotify'
import { debounce } from '@/lib/utils'

// Singleton to track initialization state
let isInitializing = false
let isInitialized = false
let initializationPromise: Promise<void> | null = null
let playerInstance: SpotifyPlayerInstance | null = null
let currentAccessToken: string | null = null

// Add a cleanup function to reset state
function resetInitializationState(): void {
  isInitializing = false
  isInitialized = false
  initializationPromise = null
  playerInstance = null
  currentAccessToken = null
}

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
  refreshToken: () => Promise<void>
}

export function useSpotifyPlayerState(
  playlistId: string
): UseSpotifyPlayerStateReturn {
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
  const tokenRefreshInterval = useRef<NodeJS.Timeout | null>(null)
  const lastReadyState = useRef<boolean>(false)

  // Track ready state changes
  useEffect(() => {
    const unsubscribe = useSpotifyPlayer.subscribe((state) => {
      if (state.isReady !== lastReadyState.current) {
        lastReadyState.current = state.isReady
      }
    })
    return () => unsubscribe()
  }, [])

  const checkPlayerReady = useCallback(async (): Promise<boolean> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      return false
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state?.device?.id) {
        return false
      }

      // Only update device ID if it's different and we don't already have a valid one
      if (state.device.id !== currentDeviceId && !isInitialized) {
        console.log('[SpotifyPlayer] Updating device ID during ready check:', {
          oldId: currentDeviceId,
          newId: state.device.id,
          isInitialized
        })
        setDeviceId(state.device.id)
      }

      const isReady = state.device.is_active
      if (isReady) {
        setIsReady(true)
      }
      return isReady
    } catch (error) {
      console.error('[SpotifyPlayer] Error checking player ready:', error)
      return false
    }
  }, [setIsReady, setDeviceId])

  const refreshToken = useCallback(async (): Promise<void> => {
    if (!isMounted.current) return
    try {
      const response = await fetch('/api/token')
      if (!response.ok) {
        throw new Error('Failed to refresh Spotify token')
      }
      const tokenData = await response.json()
      const { access_token, expires_in, scope, token_type } = tokenData
      currentAccessToken = access_token

      // Emit token update event
      const now = Date.now()
      const tokenInfo: TokenInfo = {
        lastRefresh: now,
        expiresIn: expires_in,
        scope,
        type: token_type,
        lastActualRefresh: now,
        expiryTime: now + expires_in * 1000
      }
      window.dispatchEvent(
        new CustomEvent('tokenUpdate', { detail: tokenInfo })
      )

      // Set up token refresh timer
      if (tokenRefreshInterval.current) {
        clearTimeout(tokenRefreshInterval.current)
      }
      const refreshDelay = (expires_in - 15 * 60) * 1000 // 15 minutes before expiry
      console.log(
        '[Token] Setting refresh timer for',
        new Date(now + refreshDelay)
      )
      tokenRefreshInterval.current = setTimeout(refreshToken, refreshDelay)
    } catch (error) {
      console.error('[Token] Error refreshing token:', error)
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to refresh Spotify token'
      )
    }
  }, [])

  const initializePlayer = useCallback(async (): Promise<void> => {
    // If already initialized, return immediately
    if (isInitialized) {
      return
    }

    // If already initializing, wait for the promise to resolve
    if (isInitializing && initializationPromise) {
      try {
        await initializationPromise
        return
      } catch (error) {
        // If the initialization failed, reset state and try again
        resetInitializationState()
      }
    }

    isInitializing = true

    try {
      initializationPromise = (async () => {
        try {
          // Get access token
          const tokenInfo = await sendApiRequest<{
            access_token: string
            token_type: string
            scope: string
            expires_in: number
          }>({
            path: '/api/token',
            method: 'GET',
            isLocalApi: true
          })

          currentAccessToken = tokenInfo.access_token

          // Calculate token refresh delay (refresh 5 minutes before expiry)
          const now = Date.now()
          const refreshDelay = (tokenInfo.expires_in - 300) * 1000 // 5 minutes before expiry

          tokenRefreshInterval.current = setTimeout(refreshToken, refreshDelay)

          // Wait for SDK to be ready
          if (!window.Spotify) {
            console.log('[SpotifyPlayer] Waiting for SDK to load...')
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(
                  new Error('Spotify SDK failed to load within 10 seconds')
                )
              }, 10000)

              const handleSDKReady = () => {
                clearTimeout(timeout)
                resolve()
              }

              window.addEventListener('spotifySDKReady', handleSDKReady, {
                once: true
              })
            })
          }

          // Check if we already have a player instance
          if (playerInstance) {
            isInitialized = true
            return
          }

          console.log('[SpotifyPlayer] Creating new player instance')
          const player = new window.Spotify.Player({
            name: '3B Saigon Jukebox',
            getOAuthToken: (cb: (token: string) => void) => {
              if (currentAccessToken) {
                cb(currentAccessToken)
              }
            },
            volume: 0.5
          })

          // Add a delay before connecting to ensure SDK is fully loaded
          await new Promise((resolve) => setTimeout(resolve, 1000))

          console.log('[SpotifyPlayer] Attempting to connect player')
          const connected = await player.connect()
          if (!connected) {
            throw new Error('Failed to connect to Spotify player')
          }

          console.log('[SpotifyPlayer] Player connected successfully')
          playerInstance = player
          window.spotifyPlayerInstance = player

          // Set up player event listeners
          player.addListener('ready', ({ device_id }) => {
            console.log(
              '[SpotifyPlayer] Player ready with device ID:',
              device_id
            )
            setDeviceId(device_id)
            setIsReady(true)
            isInitialized = true
            console.log('[SpotifyPlayer] Player initialization complete:', {
              deviceId: device_id,
              isReady: true,
              isInitialized: true,
              timestamp: Date.now()
            })
          })

          player.addListener('not_ready', ({ device_id }) => {
            console.log('[SpotifyPlayer] Not ready with device ID:', device_id)
            setIsReady(false)
            isInitialized = false
            console.log('[SpotifyPlayer] Player not ready:', {
              deviceId: device_id,
              isReady: false,
              isInitialized: false,
              timestamp: Date.now()
            })
          })

          player.addListener('initialization_error', ({ message }) => {
            console.error('[SpotifyPlayer] Initialization error:', message)
            setError(message)
            setIsReady(false)
            isInitialized = false
            resetInitializationState()
          })

          player.addListener('authentication_error', ({ message }) => {
            console.error('[SpotifyPlayer] Authentication error:', message)
            setError(message)
            setIsReady(false)
            isInitialized = false
            resetInitializationState()
          })

          player.addListener('account_error', ({ message }) => {
            console.error('[SpotifyPlayer] Account error:', message)
            setError(message)
            setIsReady(false)
            isInitialized = false
            resetInitializationState()
          })

          player.addListener('playback_error', ({ message }) => {
            console.error('[SpotifyPlayer] Playback error:', message)
            setError(message)
          })

          console.log(
            '[SpotifyPlayer] Player instance created and listeners attached'
          )
        } catch (error) {
          console.error('[SpotifyPlayer] Error during initialization:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
          })
          resetInitializationState()
          throw error
        }
      })()

      await initializationPromise
    } catch (error) {
      resetInitializationState()
      throw error
    }
  }, [refreshToken, setDeviceId, setIsReady, setPlaybackState])

  const reconnectPlayer = useCallback(async (): Promise<void> => {
    if (
      !isMounted.current ||
      reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS
    )
      return

    reconnectAttempts.current++

    console.log('[SpotifyPlayer] Attempting to reconnect:', {
      attempt: reconnectAttempts.current,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      timestamp: new Date().toISOString()
    })

    try {
      if (playerInstance) {
        console.log('[SpotifyPlayer] Disconnecting existing player')
        await playerInstance.disconnect()
        playerInstance = null
      }

      isInitialized = false
      initializationPromise = null

      await initializePlayer()
      reconnectAttempts.current = 0
      console.log('[SpotifyPlayer] Reconnection successful')
    } catch (_error) {
      console.error('[SpotifyPlayer] Reconnection failed:', {
        error: _error,
        attempt: reconnectAttempts.current,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        timestamp: new Date().toISOString()
      })

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        console.log('[SpotifyPlayer] Scheduling next reconnection attempt')
        setTimeout(reconnectPlayer, 2000)
      } else {
        setError(
          'Failed to reconnect to Spotify player after multiple attempts'
        )
      }
    }
  }, [isMounted, playerInstance, initializePlayer, setError])

  const refreshPlayerState = useCallback(async (): Promise<void> => {
    try {
      console.log('[SpotifyPlayer] Refreshing player state')
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id) {
        console.log('[SpotifyPlayer] State changed:', {
          deviceId: state.device.id,
          deviceName: state.device.name,
          isPlaying: state.is_playing,
          currentTrack: state.item?.name,
          timestamp: new Date().toISOString()
        })
        setPlaybackState(state)
        // Don't modify isReady state here, let the player events handle it
      } else {
        console.log('[SpotifyPlayer] No active device found in state')
      }
    } catch (error) {
      console.error('[SpotifyPlayer] Error refreshing player state:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    }
  }, [setPlaybackState])

  const refreshPlaylistState = useCallback(async (): Promise<void> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID, attempting to reconnect')
      await reconnectPlayer()
      return
    }

    try {
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

      if (!state?.device?.id) {
        console.log('[SpotifyPlayer] No active device found')
        await reconnectPlayer()
        return
      }

      if (state.device.id !== currentDeviceId) {
        console.log('[SpotifyPlayer] Device ID changed, updating state')
        setDeviceId(state.device.id)
      }

      if (state.is_playing && state.context?.uri) {
        const hasChanges = await new Promise<boolean>((resolve) => {
          const handler = (e: CustomEvent) => {
            window.removeEventListener(
              'playlistChangeStatus',
              handler as EventListener
            )
            resolve(e.detail.hasChanges)
          }
          window.addEventListener(
            'playlistChangeStatus',
            handler as EventListener
          )

          const statusEvent = new CustomEvent('getPlaylistChangeStatus')
          window.dispatchEvent(statusEvent)
        })

        if (hasChanges) {
          console.log(
            '[SpotifyPlayer] Playlist changes detected, reinitializing playback'
          )
          try {
            const currentTrackUri = state.item?.uri
            const currentPosition = state.progress_ms
            const isPlaying = state.is_playing

            // Pause playback first
            await sendApiRequest({
              path: 'me/player/pause',
              method: 'PUT'
            })

            // Wait a short moment for the pause to take effect
            await new Promise((resolve) => setTimeout(resolve, 500))

            // Reinitialize playback with the current context
            await sendApiRequest({
              path: `me/player/play?device_id=${state.device.id}`,
              method: 'PUT',
              body: {
                context_uri: state.context.uri,
                position_ms: currentPosition ?? 0,
                offset: currentTrackUri ? { uri: currentTrackUri } : undefined
              },
              debounceTime: 60000 // 1 minute debounce
            })

            // Restore previous playback state
            if (!isPlaying) {
              await new Promise((resolve) => setTimeout(resolve, 500))
              await sendApiRequest({
                path: 'me/player/pause',
                method: 'PUT'
              })
            }

            console.log('[SpotifyPlayer] Playback reinitialized successfully')
          } catch (error) {
            console.error(
              '[SpotifyPlayer] Error reinitializing playback:',
              error
            )
            // Attempt to recover by reconnecting the player
            await reconnectPlayer()
          }
        }
      }
    } catch (error) {
      console.error('[SpotifyPlayer] Error refreshing playlist state:', error)
      if (error instanceof Error && 'status' in error && error.status === 404) {
        await reconnectPlayer()
      }
    }
  }, [reconnectPlayer, setDeviceId])

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

  const verifyPlayerReady = useCallback(async (): Promise<void> => {
    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id) {
        setDeviceId(state.device.id)
        // Only set ready if we don't already have a device ID
        if (!deviceId) {
          setIsReady(true)
        }
      }
    } catch (error) {
      console.error('[SpotifyPlayer] Error verifying player:', error)
    }
  }, [setDeviceId, setIsReady, deviceId])

  useEffect(() => {
    const checkDeviceStatus = async (): Promise<void> => {
      if (!deviceId) {
        void verifyPlayerReady()
        return
      }

      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (state?.device?.id === deviceId) {
          setPlaybackState(state)
        } else if (state?.device?.id) {
          // Only update device ID if we get a different one
          setDeviceId(state.device.id)
        }
      } catch (error) {
        console.error('[SpotifyPlayer] Error checking device status:', error)
      }
    }

    const interval = setInterval(checkDeviceStatus, 5000)
    return () => clearInterval(interval)
  }, [deviceId, verifyPlayerReady, setDeviceId, setPlaybackState])

  useEffect(() => {
    const handleStateChange = (
      event: CustomEvent<SpotifyPlaybackState>
    ): void => {
      const state = event.detail
      setPlaybackState(state)
    }

    window.addEventListener(
      'playbackStateChange',
      handleStateChange as EventListener
    )
    return () => {
      window.removeEventListener(
        'playbackStateChange',
        handleStateChange as EventListener
      )
    }
  }, [setPlaybackState])

  useEffect(() => {
    const handlePlaylistRefresh = async (): Promise<void> => {
      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (state?.device?.id === deviceId) {
          setPlaybackState(state)
        }
      } catch (error) {
        console.error('[SpotifyPlayer] Error refreshing playlist state:', error)
      }
    }

    window.addEventListener(
      'playlistRefresh',
      handlePlaylistRefresh as EventListener
    )
    return () => {
      window.removeEventListener(
        'playlistRefresh',
        handlePlaylistRefresh as EventListener
      )
    }
  }, [deviceId, setPlaybackState])

  const reinitializePlayback = useCallback(async (): Promise<void> => {
    try {
      // Get current playback state
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      await sendApiRequest({
        path: `me/player/play?device_id=${state.device.id}`,
        method: 'PUT',
        body: {
          context_uri: `spotify:playlist:${playlistId}`,
          position_ms: state?.progress_ms ?? 0,
          offset: state?.item?.uri ? { uri: state.item.uri } : undefined
        },
        debounceTime: 60000 // 1 minute debounce
      })
    } catch (error) {
      console.error('[SpotifyPlayer] Error reinitializing playback:', error)
    }
  }, [playlistId])

  useEffect(() => {
    return () => {
      if (tokenRefreshInterval.current) {
        clearTimeout(tokenRefreshInterval.current)
      }
    }
  }, [])

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
    refreshPlaylistState,
    refreshToken
  }
}
