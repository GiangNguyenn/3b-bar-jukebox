'use client'

import { useEffect, useState, useRef } from 'react'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

declare global {
  interface Window {
    Spotify: any
    onSpotifyWebPlaybackSDKReady: () => void
    refreshSpotifyPlayer?: () => Promise<void>
    spotifyPlayerInstance?: any
  }
}

// Singleton to track initialization state
let isInitialized = false
let initializationPromise: Promise<void> | null = null
let playerInstance: any = null

export default function SpotifyPlayer() {
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

  // Function to check if the player is actually ready
  const checkPlayerReady = async () => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log(
        '[SpotifyPlayer] No device ID in state, checking player state',
      )
      return false
    }

    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      })

      // If we don't have a state or device ID, try to transfer playback
      if (!state?.device?.id) {
        try {
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [currentDeviceId],
              play: false,
            },
          })
          // Wait a bit for the transfer to take effect
          await new Promise((resolve) => setTimeout(resolve, 2000))
          // Check again
          const newState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET',
          })
          const isReady = newState?.device?.id === currentDeviceId
          if (isReady) {
            console.log(
              '[SpotifyPlayer] Player verified as ready after transfer',
            )
            setIsReady(true)
          }
          return isReady
        } catch (error) {
          console.error('[SpotifyPlayer] Error transferring playback:', error)
          return false
        }
      }

      const isReady = state.device.id === currentDeviceId

      if (isReady) {
        console.log('[SpotifyPlayer] Player verified as ready')
        setIsReady(true)
      }
      return isReady
    } catch (error) {
      console.error('[SpotifyPlayer] Error checking player ready:', error)
      return false
    }
  }

  // Function to refresh the player's state
  const refreshPlayerState = async () => {
    if (!deviceId) {
      return
    }

    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      })

      // Verify the device is still active
      if (state?.device?.id === deviceId) {
        setPlaybackState(state)
        setIsReady(true)
      } else {
        reconnectPlayer()
      }
    } catch (error) {
      if ((error as any)?.status === 404) {
        reconnectPlayer()
      }
    }
  }

  const reconnectPlayer = async () => {
    if (
      !isMounted.current ||
      reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS
    )
      return

    reconnectAttempts.current++

    try {
      // Clear the existing player instance
      if (playerInstance) {
        await playerInstance.disconnect()
        playerInstance = null
      }

      // Reset initialization state
      isInitialized = false
      initializationPromise = null

      // Reinitialize the player
      await initializePlayer()
      reconnectAttempts.current = 0
    } catch (error) {
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(reconnectPlayer, 2000)
      } else {
        setError(
          'Failed to reconnect to Spotify player after multiple attempts',
        )
      }
    }
  }

  const initializePlayer = async () => {
    if (isInitialized && playerInstance) {
      return
    }

    if (initializationPromise) {
      await initializationPromise
      return
    }

    initializationPromise = (async () => {
      try {
        // Fetch token from our API
        const response = await fetch('/api/token')
        if (!response.ok) {
          throw new Error('Failed to get Spotify token')
        }
        const { access_token } = await response.json()

        if (!window.Spotify) {
          throw new Error('Spotify SDK not loaded')
        }

        // Check if we already have a player instance
        if (playerInstance) {
          return
        }

        const player = new window.Spotify.Player({
          name: 'JM Bar Jukebox',
          getOAuthToken: (cb: (token: string) => void) => {
            cb(access_token)
          },
          volume: 0.5,
        })

        // Add listeners
        player.addListener(
          'ready',
          async ({ device_id }: { device_id: string }) => {
            if (!isMounted.current) return
            console.log(
              '[SpotifyPlayer] Player ready event received, device_id:',
              device_id,
            )
            setDeviceId(device_id)

            try {
              // Verify the player is actually ready
              const isReady = await checkPlayerReady()
              if (isReady) {
                console.log('[SpotifyPlayer] Player verified as ready')
                setIsReady(true)
                setError(null)
                reconnectAttempts.current = 0
                // Initial state refresh
                await refreshPlayerState()
                // Double check ready state after refresh
                const finalCheck = await checkPlayerReady()
                if (finalCheck) {
                  console.log('[SpotifyPlayer] Final ready check passed')
                  // Force a state update to ensure UI reflects ready state
                  setIsReady(true)
                } else {
                  console.log(
                    '[SpotifyPlayer] Final ready check failed, attempting reconnect',
                  )
                  reconnectPlayer()
                }
              } else {
                console.log(
                  '[SpotifyPlayer] Initial ready check failed, attempting reconnect',
                )
                reconnectPlayer()
              }
            } catch (error) {
              console.error(
                '[SpotifyPlayer] Error during ready handler:',
                error,
              )
              reconnectPlayer()
            }
          },
        )

        player.addListener(
          'not_ready',
          ({ device_id }: { device_id: string }) => {
            if (!isMounted.current) return
            setDeviceId(null)
            setIsReady(false)
            reconnectPlayer()
          },
        )

        player.addListener('player_state_changed', (state: any) => {
          if (!isMounted.current) return
          try {
            console.log('[SpotifyPlayer] State changed:', state)
            setPlaybackState(state)
            // Update ready state based on device ID match
            if (state?.device?.id === deviceId) {
              setIsReady(true)
            }
          } catch (error) {
            console.error('[SpotifyPlayer] Error handling state change:', error)
          }
        })

        player.addListener(
          'initialization_error',
          ({ message }: { message: string }) => {
            if (!isMounted.current) return
            setError(`Failed to initialize: ${message}`)
            setIsReady(false)
          },
        )

        player.addListener(
          'authentication_error',
          ({ message }: { message: string }) => {
            if (!isMounted.current) return
            setError(`Failed to authenticate: ${message}`)
            setIsReady(false)
          },
        )

        player.addListener(
          'account_error',
          ({ message }: { message: string }) => {
            if (!isMounted.current) return
            setError(`Failed to validate Spotify account: ${message}`)
            setIsReady(false)
          },
        )

        // Connect to the player
        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify player')
        }

        // Store the player instance globally
        playerInstance = player
        window.spotifyPlayerInstance = player
        isInitialized = true

        // Wait for the player to be ready
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Player ready timeout'))
          }, 10000) // 10 second timeout

          const readyHandler = async ({ device_id }: { device_id: string }) => {
            try {
              // First set the device ID and wait for it to be set
              setDeviceId(device_id)

              // Wait for the state to be updated
              await new Promise((resolve) => setTimeout(resolve, 1000))

              // Get the current device ID from the state
              const currentDeviceId = useSpotifyPlayer.getState().deviceId

              if (!currentDeviceId) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
                const retryDeviceId = useSpotifyPlayer.getState().deviceId
                if (!retryDeviceId) {
                  throw new Error('Device ID not set in state after retry')
                }
              }

              // Try to verify the player is ready up to 3 times
              let isReady = false
              let attempts = 0
              const maxAttempts = 3

              while (!isReady && attempts < maxAttempts) {
                isReady = await checkPlayerReady()
                if (!isReady) {
                  attempts++
                  if (attempts < maxAttempts) {
                    await new Promise((resolve) => setTimeout(resolve, 2000))
                  }
                }
              }

              if (isReady) {
                clearTimeout(timeout)
                player.removeListener('ready', readyHandler)
                resolve()
              } else {
                reject(
                  new Error('Player verification failed after all attempts'),
                )
              }
            } catch (error) {
              reject(error)
            }
          }

          player.addListener('ready', readyHandler)
        }).catch((error) => {
          throw error
        })

        // Force an immediate state check
        try {
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET',
          })
          if (state?.device?.id) {
            setDeviceId(state.device.id)
            setIsReady(true)
          }
        } catch (error) {
          // Ignore error in immediate check
        }

        // Start periodic checks of player state
        if (initializationCheckInterval.current) {
          clearInterval(initializationCheckInterval.current)
        }
        initializationCheckInterval.current = setInterval(async () => {
          if (deviceId) {
            const isReady = await checkPlayerReady()
            if (!isReady) {
              reconnectPlayer()
            } else {
              setIsReady(true)
            }
          }
        }, 10000) // Check every 10 seconds
      } catch (error) {
        if (!isMounted.current) return
        setError(
          error instanceof Error
            ? error.message
            : 'Failed to initialize Spotify player',
        )
        setIsReady(false)
      } finally {
        initializationPromise = null
      }
    })()

    await initializationPromise
  }

  // Function to refresh playlist state
  const refreshPlaylistState = async () => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID, attempting to reconnect')
      await reconnectPlayer()
      return
    }

    try {
      console.log('[SpotifyPlayer] Starting playlist state refresh')

      // Dispatch check notification at the start
      console.log('[SpotifyPlayer] Dispatching playlistChecked event')
      window.dispatchEvent(
        new CustomEvent('playlistChecked', {
          detail: {
            timestamp: Date.now(),
            hasChanges: false,
          },
        }),
      )

      // Get current playback state
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET',
      })

      if (state?.device?.id === currentDeviceId) {
        console.log('[SpotifyPlayer] Device is active, updating state:', {
          isPlaying: state.is_playing,
          currentTrack: state.item?.name,
          progress: state.progress_ms,
        })

        // Only reinitialize if we're currently playing and there's an actual playlist change
        if (state.is_playing && state.context?.uri) {
          // Check if this refresh was triggered by a playlist change
          console.log(
            '[SpotifyPlayer] Setting up playlist change status handler',
          )

          // Set up the response handler first
          const hasChanges = await new Promise<boolean>((resolve) => {
            const handler = (e: CustomEvent) => {
              console.log(
                '[SpotifyPlayer] Received playlistChangeStatus response:',
                e.detail,
              )
              window.removeEventListener(
                'playlistChangeStatus',
                handler as EventListener,
              )
              resolve(e.detail.hasChanges)
            }
            window.addEventListener(
              'playlistChangeStatus',
              handler as EventListener,
            )

            // Now dispatch the request event
            console.log(
              '[SpotifyPlayer] Dispatching getPlaylistChangeStatus event',
            )
            const statusEvent = new CustomEvent('getPlaylistChangeStatus')
            window.dispatchEvent(statusEvent)
          })

          if (hasChanges) {
            console.log(
              '[SpotifyPlayer] Reinitializing playback with updated playlist',
            )
            try {
              // Store current state before pausing
              const currentTrackUri = state.item?.uri
              const currentPosition = state.progress_ms
              const isPlaying = state.is_playing

              // First pause playback
              await sendApiRequest({
                path: 'me/player/pause',
                method: 'PUT',
              })

              // Dispatch event to show reinitialization notification
              console.log(
                '[SpotifyPlayer] Dispatching playlistReinitialized event',
              )
              const reinitEvent = new CustomEvent('playlistReinitialized', {
                detail: {
                  timestamp: Date.now(),
                  currentTrack: state.item?.name,
                  position: state.progress_ms,
                },
              })
              window.dispatchEvent(reinitEvent)
              console.log(
                '[SpotifyPlayer] playlistReinitialized event dispatched',
              )

              // Then resume with the exact same context and position
              await sendApiRequest({
                path: 'me/player/play',
                method: 'PUT',
                body: {
                  context_uri: state.context.uri,
                  position_ms: currentPosition,
                  offset: {
                    uri: currentTrackUri,
                  },
                },
              })

              // If it wasn't playing before, pause it again
              if (!isPlaying) {
                await sendApiRequest({
                  path: 'me/player/pause',
                  method: 'PUT',
                })
              }

              console.log(
                '[SpotifyPlayer] Playback reinitialized successfully at position:',
                currentPosition,
              )
            } catch (error) {
              console.error(
                '[SpotifyPlayer] Error reinitializing playback:',
                error,
              )
            }
          } else {
            console.log(
              '[SpotifyPlayer] No playlist changes detected, skipping reinitialization',
            )
          }
        }

        setPlaybackState(state)
        setIsReady(true)
      } else {
        console.log(
          '[SpotifyPlayer] Device is not active, attempting to reconnect',
        )
        await reconnectPlayer()
      }
    } catch (error) {
      console.error('[SpotifyPlayer] Error refreshing playlist state:', error)
      if ((error as any)?.status === 404) {
        await reconnectPlayer()
      }
    }
  }

  // Add a listener for playlist changes
  useEffect(() => {
    const handlePlaylistChange = () => {
      console.log('[SpotifyPlayer] Playlist change detected, refreshing state')
      refreshPlaylistState()
    }

    // Listen for custom playlist refresh events
    window.addEventListener('playlistRefresh', handlePlaylistChange)

    return () => {
      window.removeEventListener('playlistRefresh', handlePlaylistChange)
    }
  }, [deviceId])

  useEffect(() => {
    // Define the callback before loading the SDK
    window.onSpotifyWebPlaybackSDKReady = initializePlayer

    // Set up playlist refresh interval
    console.log('[SpotifyPlayer] Setting up playlist refresh interval')
    playlistRefreshInterval.current = setInterval(async () => {
      console.log('[SpotifyPlayer] Running scheduled playlist refresh')
      await refreshPlaylistState()
    }, 120000) // Refresh every 2 minutes

    // Only load the SDK if it hasn't been loaded yet
    if (
      !document.querySelector(
        'script[src="https://sdk.scdn.co/spotify-player.js"]',
      )
    ) {
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true

      script.onerror = () => {
        if (!isMounted.current) return
        setError('Failed to load Spotify Web Playback SDK')
        setIsReady(false)
      }

      document.body.appendChild(script)
    } else {
      initializePlayer()
    }

    return () => {
      isMounted.current = false
      if (initializationCheckInterval.current) {
        clearInterval(initializationCheckInterval.current)
      }
      if (playlistRefreshInterval.current) {
        clearInterval(playlistRefreshInterval.current)
      }
      // Don't disconnect the player here as it's a singleton
      // Only clean up the callback
      window.onSpotifyWebPlaybackSDKReady = () => {}
    }
  }, [setDeviceId, setIsReady, setPlaybackState])

  // Export the refresh function to be used by other components
  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).refreshSpotifyPlayer = refreshPlayerState
    }
  }, [deviceId])

  if (error) {
    return <div className="rounded bg-red-100 p-4 text-red-700">{error}</div>
  }

  return null
}
