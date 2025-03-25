import { useState } from "react";
import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";
import { ERROR_MESSAGES } from "@/shared/constants/errors";

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
      await sendApiRequest<SpotifyPlaylistItem>({
        path: `playlists/${todayPlaylistId}/tracks`,
        method: "POST",
        body: JSON.stringify({
          uris: [trackURI],
        }),
      });

      await refetchPlaylist();
      setIsSuccess(true);
    } catch (error: any) {
      setError(error.message || ERROR_MESSAGES.FAILED_TO_ADD);
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
