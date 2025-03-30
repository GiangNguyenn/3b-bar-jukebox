import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "../shared/api";
import { useMyPlaylists } from "./useMyPlaylists";
import { useEffect, useState } from "react";
import { formatDateForPlaylist } from "@/shared/utils/date";

export const useCreateNewDailyPlaylist = () => {
  const todayString = formatDateForPlaylist();
  const name = `Daily Mix - ${todayString}`;
  const description = `A daily mix of your favorite songs on ${todayString}`;
  const [todayPlaylistId, setTodayPlaylistId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const {
    data: playlists,
    isError,
    isLoading,
    refetchPlaylists,
  } = useMyPlaylists();

  useEffect(() => {
    refetchPlaylists();
  }, []);

  useEffect(() => {
    if (playlists?.items) {
      const existingPlaylist = playlists.items.find(
        (playlist) => playlist.name === name
      );
      if (existingPlaylist) {
        console.log(`[Daily Playlist] Found today's playlist: ${name} (ID: ${existingPlaylist.id})`);
        setTodayPlaylistId(existingPlaylist.id);
      }
    }
  }, [playlists, name]);

  const createPlaylist = async () => {
    if (!playlists || isLoading) {
      return;
    }

    const existingPlaylist =
      playlists && playlists?.items.find((playlist) => playlist.name === name);

    if (existingPlaylist) {
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

      console.log(`[Daily Playlist] Created new playlist: ${name} (ID: ${newPlaylist.id})`);
      setTodayPlaylistId(newPlaylist.id);
      return newPlaylist;
    } catch (error: any) {
      console.error("Error creating new playlist:", error);
      setError(error.message || "Failed to create playlist");
      throw error;
    }
  };

  return { createPlaylist, todayPlaylistId, playlists, isLoading, error, isError };
};
