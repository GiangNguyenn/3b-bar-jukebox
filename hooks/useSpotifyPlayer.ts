// @ts-nocheck - Spotify SDK type definitions are incomplete and incompatible with our types
import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types'
import { useCallback } from 'react'
import { useRecoverySystem } from './recovery'
import { getSpotifyToken } from '@/shared/api'

// Spotify Web Playback SDK types
interface SpotifySDKPlaybackState {
  context: {
    uri: string
    metadata: Record<string, string>
  }
  disallows: {
    pausing: boolean
    peeking_next: boolean
    peeking_prev: boolean
    resuming: boolean
    seeking: boolean
    skipping_next: boolean
    skipping_prev: boolean
  }
  duration: number
  paused: boolean
  position: number
  repeat_mode: number
  shuffle: boolean
  timestamp: number
  track_window: {
    current_track: {
      uri: string
      id: string
      type: string
      media_type: string
      name: string
      is_playable: boolean
      album: {
        uri: string
        name: string
        images: Array<{
          url: string
          height: number
          width: number
        }>
      }
      artists: Array<{
        uri: string
        name: string
      }>
      duration_ms: number
    }
    previous_tracks: Array<unknown>
    next_tracks: Array<unknown>
  }
}

type SpotifySDKEventTypes =
  | 'ready'
  | 'not_ready'
  | 'player_state_changed'
  | 'initialization_error'
  | 'authentication_error'
  | 'account_error'
  | 'playback_error'

type SpotifySDKEventCallbacks = {
  ready: (event: { device_id: string }) => void
  not_ready: (event: { device_id: string }) => void
  player_state_changed: (state: SpotifySDKPlaybackState) => void
  initialization_error: (event: { message: string }) => void
  authentication_error: (event: { message: string }) => void
  account_error: (event: { message: string }) => void
  playback_error: (event: { message: string }) => void
}

interface SpotifyPlayerInstance {
  connect: () => Promise<boolean>
  disconnect: () => void
  addListener: <T extends SpotifySDKEventTypes>(
    eventName: T,
    callback: SpotifySDKEventCallbacks[T]
  ) => void
  removeListener: <T extends SpotifySDKEventTypes>(
    eventName: T,
    callback: SpotifySDKEventCallbacks[T]
  ) => void
  getCurrentState: () => Promise<SpotifySDKPlaybackState | null>
  setName: (name: string) => Promise<void>
  getVolume: () => Promise<number>
  setVolume: (volume: number) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  togglePlay: () => Promise<void>
  seek: (position_ms: number) => Promise<void>
  previousTrack: () => Promise<void>
  nextTrack: () => Promise<void>
}

interface SpotifySDK {
  Player: new (config: {
    name: string
    getOAuthToken: (cb: (token: string) => void) => void
    volume?: number
  }) => SpotifyPlayerInstance
}

// @ts-ignore - Spotify SDK type definitions are incomplete
declare global {
  interface Window {
    Spotify: typeof Spotify
    spotifyPlayerInstance: any // Use any to avoid type conflicts
  }
}

interface SpotifyPlayerState {
  deviceId: string | null
  isReady: boolean
  playbackState: SpotifyPlaybackState | null
  setDeviceId: (deviceId: string | null) => void
  setIsReady: (isReady: boolean) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
  debug: {
    lastReadyUpdate: number
    lastDeviceIdUpdate: number
    lastPlaybackStateUpdate: number
    lastRecoveryAttempt: number
  }
}

// Recovery cooldown period (5 seconds)
const RECOVERY_COOLDOWN = 5000

export const useSpotifyPlayer = create<SpotifyPlayerState>((set, get) => ({
  deviceId: null,
  isReady: false,
  playbackState: null,
  debug: {
    lastReadyUpdate: 0,
    lastDeviceIdUpdate: 0,
    lastPlaybackStateUpdate: 0,
    lastRecoveryAttempt: 0
  },
  setDeviceId: (deviceId) => {
    set((state) => {
      // Don't update if the device ID is the same
      if (deviceId === state.deviceId) {
        return state
      }

      // Use requestAnimationFrame to ensure we're not in a render cycle
      requestAnimationFrame(() => {
        console.log('[SpotifyPlayer] Device ID updated:', deviceId)
      })

      return {
        deviceId,
        isReady: false, // Reset ready state when device ID changes
        playbackState: null, // Reset playback state on device change
        debug: {
          ...state.debug,
          lastDeviceIdUpdate: Date.now()
        }
      }
    })
  },
  setIsReady: (isReady) => {
    set((state) => {
      // Don't update if the ready state is the same
      if (isReady === state.isReady) {
        return state
      }

      // Critical error: Player became unready after being ready
      if (!isReady && state.isReady && state.deviceId) {
        // Use requestAnimationFrame to ensure we're not in a render cycle
        requestAnimationFrame(() => {
          console.error(
            '[SpotifyPlayer] Critical error: Player became unready',
            {
              deviceId: state.deviceId,
              timestamp: Date.now()
            }
          )

          // Trigger recovery if enough time has passed since last attempt
          const now = Date.now()
          if (now - state.debug.lastRecoveryAttempt > RECOVERY_COOLDOWN) {
            // Use setTimeout to avoid state updates during render
            setTimeout(() => {
              if (typeof window.spotifyPlayerInstance?.connect === 'function') {
                void window.spotifyPlayerInstance.connect()
              }
            }, 0)
          }
        })

        return {
          ...state,
          isReady: false,
          debug: {
            ...state.debug,
            lastReadyUpdate: Date.now(),
            lastRecoveryAttempt: Date.now()
          }
        }
      }

      // Only set ready to true if we have a device ID
      const newReadyState = isReady && state.deviceId ? true : false

      // Use requestAnimationFrame to ensure we're not in a render cycle
      requestAnimationFrame(() => {
        console.log('[SpotifyPlayer] Ready state updated:', newReadyState)
      })

      return {
        isReady: newReadyState,
        debug: {
          ...state.debug,
          lastReadyUpdate: Date.now()
        }
      }
    })
  },
  setPlaybackState: (playbackState) => {
    set((state) => {
      // Critical error: Lost playback state after having one
      if (playbackState === null && state.playbackState && state.isReady) {
        // Use requestAnimationFrame to ensure we're not in a render cycle
        requestAnimationFrame(() => {
          console.error('[SpotifyPlayer] Critical error: Lost playback state', {
            deviceId: state.deviceId,
            isReady: state.isReady,
            timestamp: Date.now()
          })

          // Trigger recovery if enough time has passed since last attempt
          const now = Date.now()
          if (now - state.debug.lastRecoveryAttempt > RECOVERY_COOLDOWN) {
            console.warn(
              '[SpotifyPlayer] Triggering recovery due to lost playback state'
            )
            // Use setTimeout to avoid state updates during render
            setTimeout(() => {
              if (typeof window.spotifyPlayerInstance?.connect === 'function') {
                void window.spotifyPlayerInstance.connect()
              }
            }, 0)
          }
        })

        return {
          ...state,
          playbackState: null,
          debug: {
            ...state.debug,
            lastPlaybackStateUpdate: Date.now(),
            lastRecoveryAttempt: Date.now()
          }
        }
      }

      // Use requestAnimationFrame to ensure we're not in a render cycle
      requestAnimationFrame(() => {
        console.log(
          '[SpotifyPlayer] Playback state updated:',
          playbackState?.item?.name
        )
      })

      return {
        playbackState,
        debug: {
          ...state.debug,
          lastPlaybackStateUpdate: Date.now()
        }
      }
    })
  }
}))

let playerInitializationPromise: Promise<string> | null = null

function destroyPlayer() {
  const player = window.spotifyPlayerInstance
  if (player) {
    if (typeof player.disconnect === 'function') {
      player.disconnect()
    }
    window.spotifyPlayerInstance = null
  }
  // Reset the singleton guard so a new player can be created
  playerInitializationPromise = null
}

async function createPlayer(): Promise<string> {
  if (playerInitializationPromise) {
    return playerInitializationPromise
  }
  if (window.spotifyPlayerInstance) {
    // Optionally, return the deviceId if available
    return Promise.resolve(
      useSpotifyPlayer.getState().deviceId || 'existing-player'
    )
  }
  playerInitializationPromise = (async () => {
    try {
      // Generate a unique player name with a timestamp
      const playerName = `Jukebox-${Date.now()}`

      // Ensure the Spotify SDK is loaded
      if (!window.Spotify) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Spotify SDK failed to load in time'))
          }, 10000)
          window.addEventListener(
            'spotifySDKReady',
            () => {
              clearTimeout(timeout)
              resolve()
            },
            { once: true }
          )
        })
      }

      // Get OAuth token using the shared/api util
      const accessToken = await getSpotifyToken()

      // Create the player
      // @ts-ignore - Spotify SDK type definitions are incomplete
      const player = new window.Spotify.Player({
        name: playerName,
        getOAuthToken: async (cb: (token: string) => void) => {
          cb(accessToken)
        },
        volume: 0.5
      })

      // @ts-ignore - Spotify SDK type definitions are incomplete
      window.spotifyPlayerInstance = player

      // Set up event handlers
      // @ts-ignore - Spotify SDK event types are incompatible with our custom types
      player.addListener('ready', ({ device_id }) => {
        // Use requestAnimationFrame to ensure we're not in a render cycle
        requestAnimationFrame(() => {
          useSpotifyPlayer.getState().setDeviceId(device_id)
          useSpotifyPlayer.getState().setIsReady(true)
        })
      })

      // @ts-ignore - Spotify SDK event types are incompatible with our custom types
      player.addListener('player_state_changed', (state: unknown) => {
        console.log('[SpotifyPlayer] Player state changed:', state)
        // Use requestAnimationFrame to ensure we're not in a render cycle
        requestAnimationFrame(() => {
          // Convert the SDK's PlaybackState to our SpotifyPlaybackState type
          const sdkState = state as SpotifySDKPlaybackState
          const playbackState: SpotifyPlaybackState = {
            device: {
              id: sdkState.context.uri.split(':').pop() || '',
              is_active: true,
              is_private_session: false,
              is_restricted: false,
              name: 'Web Playback SDK',
              type: 'Computer',
              volume_percent: 50,
              supports_volume: true
            },
            repeat_state:
              sdkState.repeat_mode === 0
                ? 'off'
                : sdkState.repeat_mode === 1
                  ? 'context'
                  : 'track',
            shuffle_state: sdkState.shuffle,
            context: {
              type: sdkState.context.uri.split(':')[1] || 'playlist',
              href: sdkState.context.uri,
              external_urls: {
                spotify: sdkState.context.uri
              },
              uri: sdkState.context.uri
            },
            timestamp: sdkState.timestamp,
            progress_ms: sdkState.position,
            is_playing: !sdkState.paused,
            item: sdkState.track_window?.current_track
              ? {
                  album: {
                    album_type: 'album',
                    total_tracks: 1,
                    available_markets: [],
                    external_urls: {
                      spotify: sdkState.track_window.current_track.album.uri
                    },
                    href: sdkState.track_window.current_track.album.uri,
                    id:
                      sdkState.track_window.current_track.album.uri
                        .split(':')
                        .pop() || '',
                    images:
                      sdkState.track_window.current_track.album.images.map(
                        (img) => ({
                          url: img.url,
                          height: img.height,
                          width: img.width
                        })
                      ),
                    name: sdkState.track_window.current_track.album.name,
                    release_date: '',
                    release_date_precision: 'day',
                    type: 'album',
                    uri: sdkState.track_window.current_track.album.uri,
                    artists: sdkState.track_window.current_track.artists.map(
                      (artist) => ({
                        external_urls: { spotify: artist.uri },
                        href: artist.uri,
                        id: artist.uri.split(':').pop() || '',
                        name: artist.name,
                        type: 'artist',
                        uri: artist.uri
                      })
                    )
                  },
                  artists: sdkState.track_window.current_track.artists.map(
                    (artist) => ({
                      external_urls: { spotify: artist.uri },
                      href: artist.uri,
                      id: artist.uri.split(':').pop() || '',
                      name: artist.name,
                      type: 'artist',
                      uri: artist.uri
                    })
                  ),
                  available_markets: [],
                  disc_number: 1,
                  duration_ms: sdkState.track_window.current_track.duration_ms,
                  explicit: false,
                  external_ids: {
                    isrc: '',
                    ean: '',
                    upc: ''
                  },
                  external_urls: {
                    spotify: sdkState.track_window.current_track.uri
                  },
                  href: sdkState.track_window.current_track.uri,
                  id: sdkState.track_window.current_track.id,
                  is_playable: true,
                  name: sdkState.track_window.current_track.name,
                  popularity: 0,
                  preview_url: sdkState.track_window.current_track.uri,
                  track_number: 1,
                  type: 'track',
                  uri: sdkState.track_window.current_track.uri,
                  is_local: false
                }
              : null,
            currently_playing_type: 'track',
            actions: {
              interrupting_playback: !sdkState.disallows.pausing,
              pausing: !sdkState.disallows.pausing,
              resuming: !sdkState.disallows.resuming,
              seeking: !sdkState.disallows.seeking,
              skipping_next: !sdkState.disallows.skipping_next,
              skipping_prev: !sdkState.disallows.skipping_prev,
              toggling_repeat_context: true,
              toggling_shuffle: true,
              toggling_repeat_track: true,
              transferring_playback: true
            }
          }

          useSpotifyPlayer.getState().setPlaybackState(playbackState)
        })
      })

      player.addListener('not_ready', () => {
        // Use requestAnimationFrame to ensure we're not in a render cycle
        requestAnimationFrame(() => {
          useSpotifyPlayer.getState().setIsReady(false)
        })
      })

      player.addListener('initialization_error', ({ message }) => {
        console.error('[SpotifyPlayer] Initialization error:', message)
      })

      player.addListener('authentication_error', ({ message }) => {
        console.error('[SpotifyPlayer] Authentication error:', message)
      })

      player.addListener('account_error', ({ message }) => {
        console.error('[SpotifyPlayer] Account error:', message)
      })

      player.addListener('playback_error', ({ message }) => {
        console.error('[SpotifyPlayer] Playback error:', message)
      })

      // Connect to Spotify
      const connected = await player.connect()
      if (!connected) {
        throw new Error('Failed to connect to Spotify')
      }

      // Store the player instance
      window.spotifyPlayerInstance = player

      return useSpotifyPlayer.getState().deviceId || 'new-player'
    } catch (error) {
      console.error('[SpotifyPlayer] Error creating player:', error)
      throw error
    }
  })()

  return playerInitializationPromise
}

export { destroyPlayer, createPlayer }
