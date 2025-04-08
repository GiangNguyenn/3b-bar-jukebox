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
    set((state) => ({
      deviceId,
      debug: {
        ...state.debug,
        lastDeviceIdUpdate: Date.now()
      }
    }));
  },
  setIsReady: (isReady) => {
    set((state) => ({
      isReady,
      debug: {
        ...state.debug,
        lastReadyUpdate: Date.now()
      }
    }));
  },
  setPlaybackState: (playbackState) => {
    set((state) => ({
      playbackState,
      debug: {
        ...state.debug,
        lastPlaybackStateUpdate: Date.now()
      }
    }));
  }
})) 