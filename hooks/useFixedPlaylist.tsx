import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "../shared/api";
import { useMyPlaylists } from "./useMyPlaylists";
import { useEffect, useState } from "react";
import { ERROR_MESSAGES, ErrorMessage } from "@/shared/constants/errors";

const FIXED_PLAYLIST_NAME = "3B Saigon";

export const useFixedPlaylist = () => {
  const [fixedPlaylistId, setFixedPlaylistId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [isInitialFetchComplete, setIsInitialFetchComplete] = useState(false);

  const { data: playlists, isError, refetchPlaylists } = useMyPlaylists();

  // Check for existing playlist whenever playlists data changes
  useEffect(() => {
    if (playlists?.items) {
      const existingPlaylist = playlists.items.find(
        (playlist) => playlist.name === FIXED_PLAYLIST_NAME,
      );
      if (existingPlaylist) {
        setFixedPlaylistId(existingPlaylist.id);
      } else {
        setError(ERROR_MESSAGES.FAILED_TO_LOAD);
      }
    }
  }, [playlists]);

  // Fetch playlists on mount
  useEffect(() => {
    const fetchPlaylists = async () => {
      try {
        await refetchPlaylists();
        setIsInitialFetchComplete(true);
      } catch (error) {
        console.error("[Fixed Playlist] Error fetching playlists:", error);
        setIsInitialFetchComplete(true);
        setError(ERROR_MESSAGES.FAILED_TO_LOAD);
      }
    };
    void fetchPlaylists();
  }, [refetchPlaylists]);

  // No-op since we don't create playlists anymore
  const createPlaylist = async (): Promise<SpotifyPlaylistItem | null> => {
    return null;
  };

  return {
    fixedPlaylistId,
    createPlaylist,
    playlists,
    isLoading,
    error,
    isError,
    isInitialFetchComplete,
  };
};
