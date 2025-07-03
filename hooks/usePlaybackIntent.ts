import { create } from 'zustand'

interface PlaybackIntentState {
  userIntent: 'playing' | 'paused'
  setUserIntent: (intent: 'playing' | 'paused') => void
}

export const usePlaybackIntentStore = create<PlaybackIntentState>((set) => ({
  userIntent: 'paused', // Default to paused
  setUserIntent: (intent) => set({ userIntent: intent })
}))
