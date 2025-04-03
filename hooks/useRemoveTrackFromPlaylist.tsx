import { useState } from "react";
import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";
import { ERROR_MESSAGES, ErrorMessage } from "@/shared/constants/errors";

interface ApiError {
  message?: string;
  error?: {
    message?: string;
    status?: number;
  };
  details?: {
    errorMessage?: string;
  };
}

export const useRemoveTrackFromPlaylist = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  
  const { todayPlaylistId, error: playlistError, isError: isPlaylistError } = useCreateNewDailyPlaylist();
  const { data: playlist, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  const removeTrack = async (trackToRemove: TrackItem) => {
    // Reset states
    setError(null);
    setIsSuccess(false);
    setIsLoading(true);

    if (isPlaylistError || playlistError) {
      setError(playlistError || ERROR_MESSAGES.FAILED_TO_LOAD);
      setIsLoading(false);
      return;
    }

    if (!playlist || !todayPlaylistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      setIsLoading(false);
      return;
    }

    try {
      console.log(`[Remove Track] Removing track ${trackToRemove.track.uri} from playlist ${todayPlaylistId}`);
      await sendApiRequest<SpotifyPlaylistItem>({
        path: `playlists/${todayPlaylistId}/tracks`,
        method: "DELETE",
        body: {
          tracks: [{
            uri: trackToRemove.track.uri
          }]
        },
      });

      console.log('[Remove Track] Track removed successfully, refreshing playlist');
      await refetchPlaylist();
      setIsSuccess(true);
      setIsLoading(false);
    } catch (error: unknown) {
      console.error('[Remove Track] Error removing track:', error);
      setError(ERROR_MESSAGES.FAILED_TO_REMOVE);
      setIsLoading(false);
    }
  };

  return { 
    removeTrack,
    isLoading,
    error,
    isSuccess
  };
}; 