import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types'

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
    console.log('[SpotifyPlayer] Setting deviceId:', deviceId);
    set((state) => ({
      deviceId,
      debug: {
        ...state.debug,
        lastDeviceIdUpdate: Date.now()
      }
    }));
  },
  setIsReady: (isReady) => {
    console.log('[SpotifyPlayer] Setting isReady:', isReady);
    set((state) => ({
      isReady,
      debug: {
        ...state.debug,
        lastReadyUpdate: Date.now()
      }
    }));
  },
  setPlaybackState: (playbackState) => {
    console.log('[SpotifyPlayer] Setting playbackState:', playbackState?.device?.id);
    set((state) => ({
      playbackState,
      debug: {
        ...state.debug,
        lastPlaybackStateUpdate: Date.now()
      }
    }));
  }
})) 