import { useState, useRef, useCallback, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState, TokenInfo } from '@/shared/types'
import type { SpotifyPlayerInstance } from '@/types/spotify'
import { debounce } from '@/lib/utils'
import { tokenManager } from '@/shared/token/tokenManager'

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
  isReady: boolean
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
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const isMounted = useRef(true)
  const reconnectAttempts = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 3
  const initializationCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const playlistRefreshInterval = useRef<NodeJS.Timeout | null>(null)
  const currentAccessToken = useRef<string | null>(null)
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

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const checkPlayerReady = useCallback(async (): Promise<boolean> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      return false
    }

    try {
      // Add a longer delay during initialization to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
        debounceTime: 15000 // Increase debounce time to 15 seconds
      })

      if (!state?.device?.id) {
        return false
      }

      // Only update device ID if we don't have one yet
      if (!currentDeviceId) {
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
          const token = await tokenManager.getToken()
          if (!token) {
            throw new Error('Failed to get Spotify token')
          }
          currentAccessToken.current = token

          // Emit token update event
          const tokenInfo: TokenInfo = {
            lastRefresh: Date.now(),
            expiresIn: 3600, // Default to 1 hour
            scope: 'streaming user-read-email user-read-private',
            type: 'Bearer',
            lastActualRefresh: Date.now(),
            expiryTime: Date.now() + 3600 * 1000
          }
          window.dispatchEvent(
            new CustomEvent('tokenUpdate', { detail: tokenInfo })
          )

          // Check if we already have a player instance
          if (playerInstance) {
            isInitialized = true
            return
          }

          console.log('[SpotifyPlayer] Creating new player instance')
          const player = new window.Spotify.Player({
            name: '3B Saigon Jukebox',
            getOAuthToken: (cb: (token: string) => void) => {
              if (currentAccessToken.current) {
                cb(currentAccessToken.current)
              }
            },
            volume: 0.5
          })

          // Add a longer delay before connecting to ensure SDK is fully loaded
          await new Promise((resolve) => setTimeout(resolve, 5000))

          console.log('[SpotifyPlayer] Attempting to connect player')
          const connected = await player.connect()
          if (!connected) {
            console.warn('[SpotifyPlayer] Failed to connect to Spotify player')
            throw new Error('Failed to connect to Spotify player')
          }

          console.log('[SpotifyPlayer] Player connected successfully')
          // @ts-ignore - Spotify SDK type definitions are incompatible with our custom types
          playerInstance = player
          // @ts-ignore - Spotify SDK type definitions are incompatible with our custom types
          window.spotifyPlayerInstance = player

          // Set up player event listeners
          player.addListener('ready', ({ device_id }) => {
            setDeviceId(device_id)
            setIsReady(true)
            isInitialized = true
          })

          player.addListener('not_ready', ({ device_id }) => {
            setIsReady(false)
            isInitialized = false
          })

          // Add a timeout to force initialization if ready event doesn't fire
          const initializationTimeout = setTimeout(() => {
            if (!isInitialized) {
              console.warn(
                '[SpotifyPlayer] Forcing initialization after timeout'
              )
              const currentState = useSpotifyPlayer.getState()
              if (currentState.deviceId) {
                setIsReady(true)
                isInitialized = true
              }
            }
          }, 15000) // 15 second timeout

          // Clean up timeout on successful initialization
          const cleanup = () => {
            clearTimeout(initializationTimeout)
          }

          // Set up error listeners
          player.addListener('initialization_error', ({ message }) => {
            cleanup()
            setError(message)
            setIsReady(false)
            isInitialized = false
            resetInitializationState()
          })

          player.addListener('authentication_error', ({ message }) => {
            cleanup()
            setError(message)
            setIsReady(false)
            isInitialized = false
            resetInitializationState()
          })

          player.addListener('account_error', ({ message }) => {
            cleanup()
            setError(message)
            setIsReady(false)
            isInitialized = false
            resetInitializationState()
          })

          player.addListener('playback_error', ({ message }) => {
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
  }, [setDeviceId, setIsReady, setPlaybackState])

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
        await playerInstance.disconnect()
        playerInstance = null
      }

      isInitialized = false
      initializationPromise = null

      await initializePlayer()
      reconnectAttempts.current = 0
    } catch (_error) {
      console.error('[SpotifyPlayer] Reconnection failed:', {
        error: _error,
        attempt: reconnectAttempts.current,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        timestamp: new Date().toISOString()
      })

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
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
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id) {
        setPlaybackState(state)
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
      setTimeout(reconnectPlayer, 2000)
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
        setTimeout(reconnectPlayer, 2000)
        return
      }

      if (state.device.id !== currentDeviceId) {
        console.warn(
          '[SpotifyPlayer] Device ID mismatch, attempting recovery',
          {
            expected: currentDeviceId,
            actual: state.device.id,
            timestamp: Date.now()
          }
        )
        setTimeout(reconnectPlayer, 2000)
        return
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
          console.warn(
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
          } catch (error) {
            setTimeout(reconnectPlayer, 2000)
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        setTimeout(reconnectPlayer, 2000)
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
        // Add debounce to prevent rapid checks
        await new Promise((resolve) => setTimeout(resolve, 10000))

        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET',
          debounceTime: 15000 // Increase debounce time to 15 seconds
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

    const interval = setInterval(checkDeviceStatus, 15000) // Increase interval to 15 seconds
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
    if (!deviceId) return

    const initializePlayer = async () => {
      try {
        const token = await tokenManager.getToken()
        if (!token) {
          throw new Error('Failed to get Spotify token')
        }
        currentAccessToken.current = token

        // Emit token update event
        const tokenInfo: TokenInfo = {
          lastRefresh: Date.now(),
          expiresIn: 3600, // Default to 1 hour
          scope: 'streaming user-read-email user-read-private',
          type: 'Bearer',
          lastActualRefresh: Date.now(),
          expiryTime: Date.now() + 3600 * 1000
        }
        window.dispatchEvent(
          new CustomEvent('tokenUpdate', { detail: tokenInfo })
        )
      } catch (error) {
        console.error('[Player] Error initializing player:', error)
        setError(
          error instanceof Error
            ? error.message
            : 'Failed to initialize player'
        )
      }
    }

    void initializePlayer()
  }, [deviceId])

  return {
    error,
    setError,
    setDeviceId,
    setIsReady,
    setPlaybackState,
    deviceId,
    isReady,
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
    refreshToken: async () => {
      // This is now a no-op since token management is handled by tokenManager
      return Promise.resolve()
    }
  }
}
