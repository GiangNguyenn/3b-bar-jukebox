import { create } from 'zustand'
import { SpotifyPlaylistItem } from '@/shared/types/spotify'

interface PlaylistState {
  currentPlaylist: SpotifyPlaylistItem | null
  setCurrentPlaylist: (playlist: SpotifyPlaylistItem | null) => void
}

export const usePlaylistStore = create<PlaylistState>()((set) => ({
  currentPlaylist: null,
  setCurrentPlaylist: (playlist) => set({ currentPlaylist: playlist })
}))
