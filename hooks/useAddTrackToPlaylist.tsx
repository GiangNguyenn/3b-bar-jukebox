import { useState } from "react";
import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";

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
      setError(playlistError || "Failed to load playlist");
      setIsLoading(false);
      return;
    }

    if (!playlist || !todayPlaylistId) {
      setError("No playlist available");
      setIsLoading(false);
      return;
    }

    // Check if track already exists in playlist
    const trackExists = playlist.tracks.items.some(
      (item: TrackItem) => item.track.uri === trackURI
    );

    if (trackExists) {
      setError("Track already exists in playlist");
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
      setError(error.message || "Failed to add track to playlist");
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
