import { useEffect, useRef } from 'react';
import { useRemoveTrackFromPlaylist } from './useRemoveTrackFromPlaylist';
import { SpotifyPlaybackState, TrackItem } from '@/shared/types';
import { filterUpcomingTracks } from '@/lib/utils';

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
  const { removeTrack, isLoading, error, isSuccess } = useRemoveTrackFromPlaylist();
  const lastProcessedTrackRef = useRef<string | null>(null);
  const lastProcessedTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!currentTrackId || !playbackState || isLoading) return;

    // Prevent processing the same track multiple times in quick succession
    const now = Date.now();
    if (currentTrackId === lastProcessedTrackRef.current && now - lastProcessedTimeRef.current < 5000) {
      return;
    }

    const currentTrack = playlistTracks.find(track => track.track.id === currentTrackId);
    if (!currentTrack) return;

    // Check if the track has finished playing
    const isTrackFinished = playbackState.progress_ms >= currentTrack.track.duration_ms;
    const isTrackNearEnd = playbackState.progress_ms >= currentTrack.track.duration_ms - 1000; // Within 1 second of ending

    if (isTrackFinished || (isTrackNearEnd && !playbackState.is_playing)) {
      console.log(`[Auto Remove] Track ${currentTrack.track.name} has finished playing, removing from playlist`);
      removeTrack(currentTrack);
      lastProcessedTrackRef.current = currentTrackId;
      lastProcessedTimeRef.current = now;
    }

    // Check if we need to remove the oldest track
    const { shouldRemoveOldest } = filterUpcomingTracks(playlistTracks, currentTrackId);
    if (shouldRemoveOldest && playlistTracks.length > 0) {
      const oldestTrack = playlistTracks[0];
      console.log(`[Auto Remove] Current track is more than 5 tracks from start, removing oldest track: ${oldestTrack.track.name}`);
      removeTrack(oldestTrack);
    }
  }, [currentTrackId, playbackState, playlistTracks, isLoading, removeTrack]);

  return {
    isLoading,
    error,
    isSuccess
  };
}; 