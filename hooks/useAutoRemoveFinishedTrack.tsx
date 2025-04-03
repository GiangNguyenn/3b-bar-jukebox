import { useEffect } from 'react';
import { useRemoveTrackFromPlaylist } from './useRemoveTrackFromPlaylist';
import { SpotifyPlaybackState, TrackItem } from '@/shared/types';
import { filterUpcomingTracks } from '../lib/utils';

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

  useEffect(() => {
    // Don't remove any tracks if we don't have the necessary data or if we're loading
    if (!currentTrackId || !playbackState || !playlistTracks.length || isLoading) {
      return;
    }

    // Find the index of the current track in the playlist
    const currentTrackIndex = playlistTracks.findIndex(track => track.track.id === currentTrackId);
    
    // Remove the oldest track if the current track is at least 5 positions from the start
    if (currentTrackIndex >= 5) {
      console.log('[Auto Remove] Removing oldest track:', playlistTracks[0].track.name);
      removeTrack(playlistTracks[0]);
    }
  }, [currentTrackId, playbackState, playlistTracks, removeTrack, isLoading]);
}; 