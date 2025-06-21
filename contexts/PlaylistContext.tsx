'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'
import { SpotifyPlaylistItem } from '@/shared/types/spotify'

interface PlaylistContextType {
  currentPlaylist: SpotifyPlaylistItem | null
  setCurrentPlaylist: (playlist: SpotifyPlaylistItem | null) => void
}

const PlaylistContext = createContext<PlaylistContextType | undefined>(
  undefined
)

export const PlaylistProvider = ({ children }: { children: ReactNode }) => {
  const [currentPlaylist, setCurrentPlaylist] =
    useState<SpotifyPlaylistItem | null>(null)

  return (
    <PlaylistContext.Provider value={{ currentPlaylist, setCurrentPlaylist }}>
      {children}
    </PlaylistContext.Provider>
  )
}

export const usePlaylistContext = () => {
  const context = useContext(PlaylistContext)
  if (context === undefined) {
    throw new Error('usePlaylistContext must be used within a PlaylistProvider')
  }
  return context
}
