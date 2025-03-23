import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";

interface AddTrackResult {
  success: boolean;
  reason?: 'TRACK_EXISTS' | 'NO_PLAYLIST' | 'API_ERROR';
}

export const useAddTrackToPlaylist = () => {
  const { todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: playlist, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  const addTrack = async (trackURI: string): Promise<AddTrackResult> => {
    if (!playlist || !todayPlaylistId) {
      return { success: false, reason: 'NO_PLAYLIST' };
    }

    // Check if track already exists in playlist
    const trackExists = playlist.tracks.items.some(
      (item: TrackItem) => item.track.uri === trackURI
    );

    if (trackExists) {
      console.log("Track already exists in playlist");
      return { success: false, reason: 'TRACK_EXISTS' };
    }

    try {
      await sendApiRequest<SpotifyPlaylistItem>({
        path: `playlists/${todayPlaylistId}/tracks`,
        method: "POST",
        body: JSON.stringify({
          uris: [trackURI],
        }),
      });

      refetchPlaylist();
      return { success: true };
    } catch (error) {
      console.error("Error adding track to playlist:", error);
      return { success: false, reason: 'API_ERROR' };
    }
  };
  return { addTrack };
};
