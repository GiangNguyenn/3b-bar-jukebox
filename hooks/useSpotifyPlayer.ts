import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types'
import { useCallback } from 'react'
import { useRecoverySystem } from './recovery'

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

      // Critical error: Lost device ID after initialization
      if (deviceId === null && state.deviceId && state.isReady) {
        console.error(
          '[SpotifyPlayer] Critical error: Lost device ID after initialization',
          {
            currentId: state.deviceId,
            isReady: state.isReady,
            timestamp: Date.now()
          }
        )

        // Trigger recovery if enough time has passed since last attempt
        const now = Date.now()
        if (now - state.debug.lastRecoveryAttempt > RECOVERY_COOLDOWN) {
          console.log(
            '[SpotifyPlayer] Triggering recovery due to lost device ID'
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
          deviceId: null,
          isReady: false,
          debug: {
            ...state.debug,
            lastDeviceIdUpdate: now,
            lastRecoveryAttempt: now
          }
        }
      }

      // Don't update if we already have a device ID and the player is ready
      if (state.deviceId && state.isReady) {
        console.log(
          '[SpotifyPlayer] Ignoring device ID change after initialization:',
          {
            currentId: state.deviceId,
            newId: deviceId,
            isReady: state.isReady,
            timestamp: Date.now()
          }
        )
        return state
      }

      console.log('[SpotifyPlayer] Setting device ID:', {
        deviceId,
        currentDeviceId: state.deviceId,
        isReady: state.isReady,
        timestamp: Date.now()
      })

      return {
        deviceId,
        isReady: false, // Reset ready state when device ID changes
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
          console.log(
            '[SpotifyPlayer] Triggering recovery due to player becoming unready'
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
      console.log('[SpotifyPlayer] Setting ready state:', {
        isReady,
        deviceId: state.deviceId,
        currentReadyState: state.isReady,
        newReadyState,
        timestamp: Date.now()
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
        console.error('[SpotifyPlayer] Critical error: Lost playback state', {
          deviceId: state.deviceId,
          isReady: state.isReady,
          timestamp: Date.now()
        })

        // Trigger recovery if enough time has passed since last attempt
        const now = Date.now()
        if (now - state.debug.lastRecoveryAttempt > RECOVERY_COOLDOWN) {
          console.log(
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
