'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors';

interface PlaylistContextType {
  todayPlaylistId: string | null;
  todayPlaylistName: string;
  hasAttemptedCreation: boolean;
  setHasAttemptedCreation: (value: boolean) => void;
  error: ErrorMessage | null;
  setError: (error: ErrorMessage | null) => void;
}

const PlaylistContext = createContext<PlaylistContextType | null>(null);

export const PlaylistProvider = ({ children }: { children: ReactNode }) => {
  const [hasAttemptedCreation, setHasAttemptedCreation] = useState(false);
  const [todayPlaylistId, setTodayPlaylistId] = useState<string | null>(null);
  const [error, setError] = useState<ErrorMessage | null>(null);

  const todayPlaylistName = `Daily Playlist - ${new Date().toLocaleDateString()}`;

  return (
    <PlaylistContext.Provider
      value={{
        todayPlaylistId,
        todayPlaylistName,
        hasAttemptedCreation,
        setHasAttemptedCreation,
        error,
        setError,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
};

export const usePlaylistContext = () => {
  const context = useContext(PlaylistContext);
  if (!context) {
    throw new Error('usePlaylistContext must be used within a PlaylistProvider');
  }
  return context;
}; 