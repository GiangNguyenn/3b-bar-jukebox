import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "../shared/api";
import { useMyPlaylists } from "./useMyPlaylists";

export const useCreateNewDailyPlaylist = () => {
  const todayString = new Date().toLocaleDateString();
  const name = `Daily Mix - ${todayString}`;
  const description = `A daily mix of your favorite songs on ${todayString}`;

  const {
    data: playlists,
    isError,
    isLoading,
    refetchPlaylists,
  } = useMyPlaylists();
  refetchPlaylists();

  const createPlaylist = async () => {
    if (isLoading || isError) {
      console.error("Error fetching playlists or data is still loading.");
      return;
    }

    const existingPlaylist = playlists?.items.find(
      (playlist) => playlist.name === name
    );

    if (existingPlaylist) {
      console.log("Playlist already exists:", existingPlaylist);
      return existingPlaylist;
    }

    try {
      const newPlaylist = await sendApiRequest<SpotifyPlaylistItem>({
        path: `me/playlists`,
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          public: false,
        }),
      });

      console.log("New playlist created:", newPlaylist);
      return newPlaylist;
    } catch (error) {
      console.error("Error creating new playlist:", error);
      throw error;
    }
  };

  refetchPlaylists();


  const todayPlaylistId = playlists?.items.find(
    (playlist) => playlist.name === name
  )?.id;

  return { createPlaylist, todayPlaylistId, playlists };
};
