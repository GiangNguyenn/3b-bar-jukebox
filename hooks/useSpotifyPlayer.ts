import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types'
import { useCallback } from 'react'
import { useRecoverySystem } from './recovery'
import { getSpotifyToken } from '@/shared/api'

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
        console.error('[SpotifyPlayer] Critical error: Player became unready', {
          deviceId: state.deviceId,
          timestamp: Date.now()
        })

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

        return {
          ...state,
          isReady: false,
          debug: {
            ...state.debug,
            lastReadyUpdate: now,
            lastRecoveryAttempt: now
          }
        }
      }

      // Only set ready to true if we have a device ID
      const newReadyState = isReady && state.deviceId ? true : false
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

        return {
          ...state,
          playbackState: null,
          debug: {
            ...state.debug,
            lastPlaybackStateUpdate: now,
            lastRecoveryAttempt: now
          }
        }
      }

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

function destroyPlayer() {
  // Disconnect and cleanup the global Spotify player instance
  const player = window.spotifyPlayerInstance
  if (player) {
    if (typeof player.disconnect === 'function') {
      player.disconnect()
    }
    // Note: removeListener requires the original callback reference, which we may not have here.
    // If you want to remove specific listeners, you must keep references to the callbacks when adding them.
    // For now, we only disconnect and clear the global reference.
    window.spotifyPlayerInstance = null
  }
}

async function createPlayer(): Promise<string> {
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
  const player = new window.Spotify.Player({
    name: playerName,
    getOAuthToken: (cb: (token: string) => void) => {
      if (accessToken) cb(accessToken)
    },
    volume: 0.5
  })

  // Assign to global reference
  window.spotifyPlayerInstance = player

  // Return a promise that resolves with the device ID when ready
  return new Promise((resolve, reject) => {
    let resolved = false
    const onReady = ({ device_id }: { device_id: string }) => {
      // Set deviceId and isReady in Zustand store
      useSpotifyPlayer.getState().setDeviceId(device_id)
      useSpotifyPlayer.getState().setIsReady(true)
      resolved = true
      resolve(device_id)
    }
    const onError = (event: { message: string }) => {
      if (!resolved) {
        reject(new Error(event.message))
      }
    }
    player.addListener('ready', onReady)
    player.addListener('initialization_error', onError)
    player.addListener('authentication_error', onError)
    player.addListener('account_error', onError)
    player.addListener('playback_error', onError)
    player.addListener('not_ready', () => {})

    // Connect the player
    player.connect().then((connected: boolean) => {
      if (!connected && !resolved) {
        reject(new Error('Failed to connect to Spotify player'))
      }
    })
  })
}

export { destroyPlayer, createPlayer }
