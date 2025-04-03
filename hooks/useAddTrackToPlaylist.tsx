import { useState, useEffect } from 'react';
import { TrackItem } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { sendApiRequest } from '@/shared/api';
import { useGetPlaylist } from './useGetPlaylist';

interface UseAddTrackToPlaylistProps {
  playlistId: string;
}

export const useAddTrackToPlaylist = ({ playlistId }: UseAddTrackToPlaylistProps) => {
  const { isError: playlistError, refetchPlaylist } = useGetPlaylist(playlistId);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!playlistId) return ERROR_MESSAGES.NO_PLAYLIST;
    if (playlistError) return 'Failed to load playlist';
    return null;
  });
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!playlistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      setIsSuccess(false);
    } else if (playlistError) {
      setError('Failed to load playlist');
      setIsSuccess(false);
    }
  }, [playlistId, playlistError]);

  const addTrack = async (track: TrackItem, onSuccess?: () => void) => {
    if (!playlistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      setIsSuccess(false);
      return;
    }

    if (playlistError) {
      setError('Failed to load playlist');
      setIsSuccess(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsSuccess(false);

    try {
      console.log(`[Add Track] Adding track ${track.track.uri} to playlist ${playlistId}`);
      
      await sendApiRequest({
        path: `playlists/${playlistId}/tracks`,
        method: "POST",
        body: {
          uris: [track.track.uri]
        }
      });

      console.log('[Add Track] Track added successfully, refreshing playlist');
      await refetchPlaylist();
      setIsSuccess(true);
      setError(null);
      onSuccess?.();
    } catch (error: unknown) {
      console.error('[Add Track] Error adding track:', error);
      setError(ERROR_MESSAGES.FAILED_TO_ADD);
      setIsSuccess(false);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    addTrack,
    isLoading,
    error,
    isSuccess
  };
};
