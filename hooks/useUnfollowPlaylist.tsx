import { useState, useCallback } from "react";
import { sendApiRequest } from "@/shared/api";
import { useMyPlaylists } from "./useMyPlaylists";
import { SpotifyPlaylistItem } from "@/shared/types";


interface UnfollowPlaylistResult {

  success: boolean;
  error?: string;
}


interface UnfollowPlaylistOptions {

  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
}


interface UseUnfollowPlaylistReturn {

  unfollowPlaylist: (options?: UnfollowPlaylistOptions) => Promise<UnfollowPlaylistResult>;
  isLoading: boolean;
  error: Error | null;
  playlist: SpotifyPlaylistItem | null;
}


export const useUnfollowPlaylist = (playlist: SpotifyPlaylistItem | null): UseUnfollowPlaylistReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { refetchPlaylists } = useMyPlaylists();

  const unfollowPlaylist = useCallback(async (
    options: UnfollowPlaylistOptions = {}
  ): Promise<UnfollowPlaylistResult> => {
    if (!playlist) {
      const error = new Error("No playlist provided");
      setError(error);
      options.onError?.(error);
      return { success: false, error: error.message };
    }

    const { onSuccess, onError, onStart } = options;
    onStart?.();
    setIsLoading(true);
    setError(null);

    try {
      await sendApiRequest({
        path: `playlists/${playlist.id}/followers`,
        method: "DELETE",
      });

      await refetchPlaylists();
      onSuccess?.();
      return { success: true };
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || "Failed to unfollow playlist";
      const error = new Error(errorMessage);
      setError(error);
      onError?.(error);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [playlist, refetchPlaylists]);

  return {
    unfollowPlaylist,
    isLoading,
    error,
    playlist,
  };
}; 