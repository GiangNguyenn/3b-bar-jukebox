import { useState } from "react";
import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";
import { ERROR_MESSAGES } from "@/shared/constants/errors";

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

export const useAddTrackToPlaylist = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  
  const { todayPlaylistId, error: playlistError, isError: isPlaylistError } = useCreateNewDailyPlaylist();
  const { data: playlist, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  const addTrack = async (trackURI: string) => {
    // Reset states
    setIsLoading(true);
    setError(null);
    setIsSuccess(false);

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

    // Check if track already exists in playlist
    const trackExists = playlist.tracks.items.some(
      (item: TrackItem) => item.track.uri === trackURI
    );

    if (trackExists) {
      setError(ERROR_MESSAGES.TRACK_EXISTS);
      setIsLoading(false);
      return;
    }

    try {
      console.log(`[Add Track] Adding track ${trackURI} to playlist ${todayPlaylistId}`);
      await sendApiRequest<SpotifyPlaylistItem>({
        path: `playlists/${todayPlaylistId}/tracks`,
        method: "POST",
        body: JSON.stringify({
          uris: [trackURI],
        }),
      });

      console.log('[Add Track] Track added successfully, refreshing playlist');
      await refetchPlaylist();
      setIsSuccess(true);
    } catch (error: unknown) {
      console.error('[Add Track] Error adding track:', error);
      
      // Extract error message from various possible error formats
      let errorMessage = ERROR_MESSAGES.FAILED_TO_ADD;
      if (error instanceof Error) {
        errorMessage = error.message || ERROR_MESSAGES.FAILED_TO_ADD;
      } else if (typeof error === 'object' && error !== null) {
        const apiError = error as ApiError;
        errorMessage = apiError.message || 
                      apiError.error?.message || 
                      apiError.details?.errorMessage || 
                      ERROR_MESSAGES.FAILED_TO_ADD;
      }
      
      setError(errorMessage);
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
