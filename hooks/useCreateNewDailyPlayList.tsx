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
  const [hasFoundExisting, setHasFoundExisting] = useState(false);
  const [hasAttemptedCreation, setHasAttemptedCreation] = useState(false);
  const [isInitialFetchComplete, setIsInitialFetchComplete] = useState(false);
  
  const {
    data: playlists,
    isError,
    refetchPlaylists,
  } = useMyPlaylists();

  // Check for existing playlist whenever playlists data changes
  useEffect(() => {
    if (playlists?.items) {
      const existingPlaylist = playlists.items.find(
        (playlist) => playlist.name === name
      );
      if (existingPlaylist) {
        console.log(`[Daily Playlist] Found today's playlist: ${name} (ID: ${existingPlaylist.id})`);
        setTodayPlaylistId(existingPlaylist.id);
        setHasFoundExisting(true);
      } else {
        console.log(`[Daily Playlist] No existing playlist found for: ${name}`);
      }
    }
  }, [playlists, name]);

  // Fetch playlists on mount
  useEffect(() => {
    const fetchPlaylists = async () => {
      try {
        await refetchPlaylists();
        setIsInitialFetchComplete(true);
      } catch (error) {
        console.error('[Daily Playlist] Error fetching playlists:', error);
        setIsInitialFetchComplete(true); // Still mark as complete to prevent hanging
      }
    };
    void fetchPlaylists();
  }, [refetchPlaylists]);

  const createPlaylist = async (): Promise<SpotifyPlaylistItem | null> => {
    // Don't create if we haven't completed initial fetch
    if (!isInitialFetchComplete) {
      console.log('[Daily Playlist] Waiting for initial playlist fetch to complete');
      return null;
    }

    // Double-check for existing playlist before creating
    if (playlists?.items) {
      const existingPlaylist = playlists.items.find(
        (playlist) => playlist.name === name
      );
      if (existingPlaylist) {
        console.log(`[Daily Playlist] Found existing playlist during creation check: ${name} (ID: ${existingPlaylist.id})`);
        setTodayPlaylistId(existingPlaylist.id);
        setHasFoundExisting(true);
        return null;
      }
    }

    // Don't create if we already attempted creation or found existing
    if (hasAttemptedCreation || todayPlaylistId || hasFoundExisting) {
      console.log(`[Daily Playlist] Playlist already exists or creation attempted: ${name} (ID: ${todayPlaylistId})`);
      return null;
    }

    setIsLoading(true);
    setError(null);
    setHasAttemptedCreation(true);
    
    try {
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

  return { 
    createPlaylist, 
    todayPlaylistId, 
    playlists, 
    isLoading, 
    error, 
    isError,
    isInitialFetchComplete 
  };
};
