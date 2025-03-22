import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";

export const useAddTrackToPlaylist = () => {
  const { todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: playlist, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  const addTrack = async (trackURI: string) => {
    if (!playlist || !todayPlaylistId) return;

    // Check if track already exists in playlist
    const trackExists = playlist.tracks.items.some(
      (item: TrackItem) => item.track.uri === trackURI
    );

    if (trackExists) {
      console.log("Track already exists in playlist");
      return;
    }

    await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${todayPlaylistId}/tracks`,
      method: "POST",
      body: JSON.stringify({
        uris: [trackURI],
      }),
    });

    refetchPlaylist();
  };
  return { addTrack };
};
