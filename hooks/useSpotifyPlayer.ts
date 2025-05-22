import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types'
import { useCallback } from 'react'

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
  }
}

export const useSpotifyPlayer = create<SpotifyPlayerState>((set) => ({
  deviceId: null,
  isReady: false,
  playbackState: null,
  debug: {
    lastReadyUpdate: 0,
    lastDeviceIdUpdate: 0,
    lastPlaybackStateUpdate: 0
  },
  setDeviceId: (deviceId) => {
    set((state) => {
      // Don't update if the device ID is the same
      if (deviceId === state.deviceId) {
        return state
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

      // Don't update if we're getting a null device ID and we already have one
      if (deviceId === null && state.deviceId) {
        console.log(
          '[SpotifyPlayer] Ignoring null device ID when we already have one:',
          {
            currentId: state.deviceId,
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
    set((state) => ({
      playbackState,
      debug: {
        ...state.debug,
        lastPlaybackStateUpdate: Date.now()
      }
    }))
  }
}))
