import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types'

interface SpotifyPlayerState {
  deviceId: string | null
  isReady: boolean
  playbackState: SpotifyPlaybackState | null
  setDeviceId: (deviceId: string | null) => void
  setIsReady: (isReady: boolean) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
}

export const useSpotifyPlayer = create<SpotifyPlayerState>((set) => ({
  deviceId: null,
  isReady: false,
  playbackState: null,
  setDeviceId: (deviceId) => set({ deviceId }),
  setIsReady: (isReady) => set({ isReady }),
  setPlaybackState: (playbackState) => set({ playbackState }),
})) 