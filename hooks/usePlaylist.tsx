import { useState, useEffect, useCallback, useRef } from 'react';
import { SpotifyPlaylistItem, TrackItem } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';

export const usePlaylist = (playlistId: string | null) => {
  const [playlist, setPlaylist] = useState<SpotifyPlaylistItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout>();

  const refreshPlaylist = useCallback(async () => {
    if (!playlistId) return;
    
    // Clear any pending refresh
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    // Set a new timeout for the refresh
    refreshTimeoutRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/playlist/${playlistId}`);
        if (!response.ok) throw new Error('Failed to fetch playlist');
        const data = await response.json();
        setPlaylist(data);
      } catch (error) {
        console.error('Error refreshing playlist:', error);
        setError(ERROR_MESSAGES.FAILED_TO_LOAD);
      } finally {
        setIsLoading(false);
      }
    }, 500); // 500ms debounce
  }, [playlistId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Initial fetch
  useEffect(() => {
    void refreshPlaylist();
  }, [refreshPlaylist]);

  return {
    playlist,
    isLoading,
    error,
    refreshPlaylist
  };
}; 