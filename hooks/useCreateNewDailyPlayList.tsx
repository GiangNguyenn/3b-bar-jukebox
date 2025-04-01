import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "../shared/api";
import { useMyPlaylists } from "./useMyPlaylists";
import { useEffect, useState } from "react";
import { formatDateForPlaylist } from "@/shared/utils/date";
import { ERROR_MESSAGES, ErrorMessage } from "@/shared/constants/errors";

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

export const useCreateNewDailyPlaylist = () => {
  const todayString = formatDateForPlaylist();
  const name = `Daily Mix - ${todayString}`;
  const description = `A daily mix of your favorite songs on ${todayString}`;
  const [todayPlaylistId, setTodayPlaylistId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  
  const {
    data: playlists,
    isError,
    refetchPlaylists,
  } = useMyPlaylists();

  // Fetch playlists on mount
  useEffect(() => {
    void refetchPlaylists();
  }, [refetchPlaylists]);

  // Check for existing playlist whenever playlists data changes
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

  const createPlaylist = async (): Promise<SpotifyPlaylistItem | null> => {
    // Don't create if we already have a playlist ID
    if (todayPlaylistId) {
      console.log(`[Daily Playlist] Playlist already exists: ${name} (ID: ${todayPlaylistId})`);
      return null;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      // Double check if playlist exists before creating
      await refetchPlaylists();
      if (playlists?.items) {
        const existingPlaylist = playlists.items.find(
          (playlist) => playlist.name === name
        );
        if (existingPlaylist) {
          console.log(`[Daily Playlist] Found existing playlist before creation: ${name} (ID: ${existingPlaylist.id})`);
          setTodayPlaylistId(existingPlaylist.id);
          return existingPlaylist;
        }
      }

      console.log(`[Daily Playlist] Creating new playlist: ${name}`);
      const newPlaylist = await sendApiRequest<SpotifyPlaylistItem>({
        path: `me/playlists`,
        method: "POST",
        body: {
          name,
          description,
          public: false,
        },
      });

      if (!newPlaylist?.id) {
        throw new Error('Failed to create playlist: No ID returned');
      }

      console.log(`[Daily Playlist] Created new playlist: ${name} (ID: ${newPlaylist.id})`);
      setTodayPlaylistId(newPlaylist.id);
      return newPlaylist;
    } catch (error: unknown) {
      console.error("[Daily Playlist] Error creating new playlist:", error);
      
      // Extract error message from various possible error formats
      let errorMessage: ErrorMessage = ERROR_MESSAGES.FAILED_TO_CREATE;
      if (error instanceof Error) {
        // Check if the error message contains specific Spotify API errors
        if (error.message.includes('Invalid request') || error.message.includes('Bad Request')) {
          errorMessage = ERROR_MESSAGES.INVALID_PLAYLIST_DATA;
        } else if (error.message.includes('Unauthorized') || error.message.includes('Forbidden')) {
          errorMessage = ERROR_MESSAGES.UNAUTHORIZED;
        } else {
          errorMessage = (error.message || ERROR_MESSAGES.FAILED_TO_CREATE) as ErrorMessage;
        }
      } else if (typeof error === 'object' && error !== null) {
        const apiError = error as ApiError;
        const message = apiError.message || 
                      apiError.error?.message || 
                      apiError.details?.errorMessage;
        errorMessage = (message || ERROR_MESSAGES.FAILED_TO_CREATE) as ErrorMessage;
      }
      
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return { createPlaylist, todayPlaylistId, playlists, isLoading, error, isError };
};
