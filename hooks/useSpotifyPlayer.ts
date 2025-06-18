// @ts-nocheck - Spotify SDK type definitions are incomplete and incompatible with our types
import { create } from 'zustand'
import { useCallback, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

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

// Add this interface before SpotifyPlaybackState:
interface SpotifyPlaybackState {
  item: {
    id: string
    name: string
    uri: string
    duration_ms: number
    artists: Array<{ name: string; id: string }>
    album: { name: string; id: string }
  } | null
  is_playing: boolean
  progress_ms: number
  duration_ms: number
}

// Update SpotifyPlayerState to use the new type:
interface SpotifyPlayerState {
  deviceId: string | null
  isReady: boolean
  playbackState: SpotifyPlaybackState | null
  setDeviceId: (deviceId: string | null) => void
  setIsReady: (isReady: boolean) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
}

// Create the store with a different name to avoid confusion
export const spotifyPlayerStore = create<SpotifyPlayerState>((set) => ({
  deviceId: null,
  isReady: false,
  playbackState: null,
  setDeviceId: (deviceId) => set({ deviceId }),
  setIsReady: (isReady) => set({ isReady }),
  setPlaybackState: (state) => set({ playbackState: state })
}))

// Export a hook to access the store
export function useSpotifyPlayerStore() {
  return spotifyPlayerStore()
}

// Separate hook for player actions
export function useSpotifyPlayerHook() {
  const { addLog } = useConsoleLogsContext()
  const playerRef = useRef<Spotify.Player | null>(null)
  const cleanupTimeoutRef = useRef<NodeJS.Timeout>()

  const destroyPlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.disconnect()
      playerRef.current = null
    }
    spotifyPlayerStore.getState().setDeviceId(null)
    spotifyPlayerStore.getState().setIsReady(false)
    spotifyPlayerStore.getState().setPlaybackState(null)
  }, [])

  const createPlayer = useCallback(async () => {
    if (playerRef.current) {
      addLog('info', 'Player already exists, returning current device ID')
      return spotifyPlayerStore.getState().deviceId
    }

    if (typeof window.Spotify === 'undefined') {
      addLog('error', 'Spotify SDK not loaded')
      return null
    }

    try {
      // Clear any existing cleanup timeout
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current)
      }

      const player = new window.Spotify.Player({
        name: 'Jukebox Player',
        getOAuthToken: async (cb) => {
          try {
            addLog('info', 'Requesting token from /api/token', 'SpotifyPlayer')
            const response = await sendApiRequest<{ access_token: string }>({
              path: 'token',
              method: 'GET',
              isLocalApi: true
            })
            addLog('info', 'Token response received', 'SpotifyPlayer')
            if (response?.access_token) {
              cb(response.access_token)
            } else {
              throw new Error('No access token in response')
            }
          } catch (error) {
            addLog('error', 'Error getting token:', error)
            throw error
          }
        }
      })

      // Set up event listeners
      player.addListener('ready', ({ device_id }) => {
        addLog('info', 'Ready with device ID:', device_id)
        requestAnimationFrame(() => {
          const currentState = spotifyPlayerStore.getState()
          if (currentState.deviceId !== device_id) {
            addLog('info', 'Device ID changed:', {
              old: currentState.deviceId,
              new: device_id
            })
            spotifyPlayerStore.getState().setDeviceId(device_id)
          }
          spotifyPlayerStore.getState().setIsReady(true)
        })
      })

      player.addListener('not_ready', ({ device_id }) => {
        addLog('info', 'Device ID has gone offline:', device_id)
        spotifyPlayerStore.getState().setIsReady(false)
      })

      player.addListener('initialization_error', ({ message }) => {
        addLog('error', 'Failed to initialize:', message)
        destroyPlayer()
      })

      player.addListener('authentication_error', ({ message }) => {
        addLog('error', 'Failed to authenticate:', message)
        destroyPlayer()
      })

      player.addListener('account_error', ({ message }) => {
        addLog('error', 'Account error:', message)
        destroyPlayer()
      })

      player.addListener('playback_error', ({ message }) => {
        addLog('error', 'Playback error:', message)
        // Recovery is handled by the health monitor, not here
        addLog('warn', 'Playback error occurred, but recovery is handled by health monitor')
      })

      player.addListener('player_state_changed', (state) => {
        addLog('INFO', `player_state_changed event: paused=${state.paused}, loading=${state.loading}, position=${state.position}`, 'SpotifyPlayer')
        
        // Transform SDK state to our internal format
        const transformedState: SpotifyPlaybackState = {
          item: state.track_window?.current_track ? {
            id: state.track_window.current_track.id,
            name: state.track_window.current_track.name,
            uri: state.track_window.current_track.uri,
            duration_ms: state.track_window.current_track.duration_ms,
            artists: state.track_window.current_track.artists.map(artist => ({
              name: artist.name,
              id: artist.uri.split(':').pop() || ''
            })),
            album: {
              name: state.track_window.current_track.album.name,
              id: state.track_window.current_track.album.uri.split(':').pop() || ''
            }
          } : null,
          is_playing: !state.paused && !state.loading,
          progress_ms: state.position,
          duration_ms: state.duration
        }
        
        spotifyPlayerStore.getState().setPlaybackState(transformedState)
        addLog('INFO', `setPlaybackState called with: is_playing=${transformedState.is_playing}, paused=${state.paused}, loading=${state.loading}`, 'SpotifyPlayer')
        
        // Log the current store state after update
        const currentStoreState = spotifyPlayerStore.getState()
        addLog('INFO', `Store state after update: is_playing=${currentStoreState.playbackState?.is_playing}, deviceId=${currentStoreState.deviceId}`, 'SpotifyPlayer')
      })

      // Connect to Spotify
      const connected = await player.connect()
      if (!connected) {
        throw new Error('Failed to connect to Spotify')
      }

      // Store player instance
      playerRef.current = player
      window.spotifyPlayerInstance = player

      // Set up cleanup timeout
      cleanupTimeoutRef.current = setTimeout(() => {
        if (playerRef.current === player) {
          addLog('info', 'Cleanup timeout reached, destroying player')
          destroyPlayer()
        }
      }, 5 * 60 * 1000) // 5 minutes

      // Wait for device ID to be set
      let attempts = 0
      const maxAttempts = 10
      while (!spotifyPlayerStore.getState().deviceId && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        attempts++
      }

      return spotifyPlayerStore.getState().deviceId
    } catch (error) {
      addLog('error', 'Error creating player:', error)
      destroyPlayer()
      return null
    }
  }, [destroyPlayer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current)
      }
      destroyPlayer()
    }
  }, [destroyPlayer])

  return {
    createPlayer,
    destroyPlayer
  }
}
