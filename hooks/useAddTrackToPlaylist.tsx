import { TrackItem } from '@/shared/types';
import { sendApiRequest } from '@/shared/api';
import { useGetPlaylist } from './useGetPlaylist';
import { useTrackOperation } from './useTrackOperation';
import { ERROR_MESSAGES } from '@/shared/constants/errors';

interface UseAddTrackToPlaylistProps {
  playlistId: string;
}

export const useAddTrackToPlaylist = ({ playlistId }: UseAddTrackToPlaylistProps) => {
  const { isError: playlistError, refetchPlaylist } = useGetPlaylist(playlistId);
  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId,
    playlistError,
    refetchPlaylist
  });

  const addTrack = async (track: TrackItem, onSuccess?: () => void) => {
    const operation = async (track: TrackItem) => {
      console.log(`[Add Track] Adding track ${track.track.uri} to playlist ${playlistId}`);
      try {
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: "POST",
          body: {
            uris: [track.track.uri]
          }
        });
        console.log('[Add Track] Track added successfully, refreshing playlist');
        onSuccess?.();
      } catch (error) {
        console.error('[Add Track] Error adding track:', error);
        throw new Error(ERROR_MESSAGES.FAILED_TO_ADD);
      }
    };

    try {
      await executeOperation(operation, track);
    } catch (error) {
      console.error('[Add Track] Error adding track:', error);
    }
  };

  return {
    addTrack,
    isLoading,
    error,
    isSuccess
  };
};
