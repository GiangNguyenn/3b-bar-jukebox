import { TrackItem } from '@/shared/types';
import { sendApiRequest } from '@/shared/api';
import { useFixedPlaylist } from './useFixedPlaylist';
import { useGetPlaylist } from './useGetPlaylist';
import { useTrackOperation } from './useTrackOperation';
import { handleApiError, handleOperationError } from '@/shared/utils/errorHandling';
import { ERROR_MESSAGES } from '@/shared/constants/errors';

export const useRemoveTrackFromPlaylist = () => {
  const { todayPlaylistId, error: createPlaylistError } = useFixedPlaylist();
  const { isError: playlistError, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? '');
  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId: todayPlaylistId,
    playlistError: playlistError || !!createPlaylistError,
    refetchPlaylist
  });

  const removeTrack = async (track: TrackItem) => {
    const operation = async (track: TrackItem) => {
      console.log('[Remove Track] Removing track', track.track.uri, 'from playlist', todayPlaylistId);
      
      try {
        await sendApiRequest({
          path: `playlists/${todayPlaylistId}/tracks`,
          method: 'DELETE',
          body: { tracks: [{ uri: track.track.uri }] }
        });
        console.log('[Remove Track] Track removed successfully, refreshing playlist');
      } catch (error) {
        throw handleApiError(error, 'RemoveTrackFromPlaylist');
      }
    };

    await handleOperationError(
      () => executeOperation(operation, track),
      'RemoveTrackFromPlaylist',
      (error) => console.error('[Remove Track] Error removing track:', error)
    );
  };

  return {
    removeTrack: todayPlaylistId ? removeTrack : null,
    isLoading,
    error,
    isSuccess
  };
};