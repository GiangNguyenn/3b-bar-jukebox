import { sendApiRequest } from "@/shared/api";
import { useCreateNewDailyPlaylist } from "./useCreateNewDailyPlayList";
import { SpotifyPlaylistItem } from "@/shared/types";
import { useGetPlaylist } from "./useGetPlaylist";

export const useAddTrackToPlaylist = () => {
  const { todayPlaylistId } = useCreateNewDailyPlaylist();
  const { refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  const addTrack = async (trackURI: string) => {
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
