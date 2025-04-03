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
    const oldestTrack = playlistTracks[0];

    // Remove the oldest track if:
    // 1. The current track is at least 5 positions from the start
    // 2. The oldest track is not the currently playing track
    if (currentTrackIndex >= 5 && oldestTrack.track.id !== currentTrackId) {
      console.log('[Auto Remove] Removing oldest track:', oldestTrack.track.name);
      removeTrack(oldestTrack);
    }
  }, [currentTrackId, playbackState, playlistTracks, removeTrack, isLoading]);
}; 