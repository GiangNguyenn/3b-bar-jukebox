import { useEffect, useRef } from 'react';
import { useRemoveTrackFromPlaylist } from './useRemoveTrackFromPlaylist';
import { filterUpcomingTracks } from '@/lib/utils';
import { TrackItem, SpotifyPlaybackState } from '@/shared/types';

interface UseAutoRemoveFinishedTrackProps {
  currentTrackId: string | null;
  playlistTracks: TrackItem[];
  playbackState: SpotifyPlaybackState | null;
}

export const useAutoRemoveFinishedTrack = ({
  currentTrackId,
  playlistTracks,
  playbackState
}: UseAutoRemoveFinishedTrackProps) => {
  const { removeTrack, isLoading } = useRemoveTrackFromPlaylist();
  const lastRemovalTimeRef = useRef<number>(0);
  const removalTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!currentTrackId || !playbackState || isLoading || !playlistTracks.length || !removeTrack) return;

    const currentTrackIndex = playlistTracks.findIndex(track => track.track.id === currentTrackId);
    if (currentTrackIndex === -1 || currentTrackIndex < 5) return;

    // Clear any pending removal
    if (removalTimeoutRef.current) {
      clearTimeout(removalTimeoutRef.current);
    }

    // Set a new timeout for the removal
    removalTimeoutRef.current = setTimeout(() => {
      const now = Date.now();
      // Only remove if at least 5 seconds have passed since last removal
      if (now - lastRemovalTimeRef.current >= 5000) {
        console.log('[Auto Remove] Removing oldest track:', playlistTracks[0].track.name);
        removeTrack(playlistTracks[0]);
        lastRemovalTimeRef.current = now;
      }
    }, 5000);
  }, [currentTrackId, playlistTracks, playbackState, removeTrack, isLoading]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (removalTimeoutRef.current) {
        clearTimeout(removalTimeoutRef.current);
      }
    };
  }, []);
}; 