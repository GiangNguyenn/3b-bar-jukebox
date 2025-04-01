import { useCallback, useState } from "react";
import { sendApiRequest } from "../shared/api";
import { TrackDetails } from "@/shared/types";
import { ERROR_MESSAGES } from "@/shared/constants/errors";

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

export interface SpotifySearchRequest {
  query: string;
  type: string;
  limit?: number;
  offset?: number;
  market?: string;
}

interface SpotifySearchResponse {
  href: string;
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
  items: TrackDetails[];
}

const useSearchTracks = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTracks = useCallback(async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      console.log(`[Search Tracks] Searching for: ${query}`);
      const response = await sendApiRequest<{ tracks: SpotifySearchResponse }>({
        path: `search?q=${query}&type=track&limit=20`,
        method: "GET",
      });

      console.log(`[Search Tracks] Found ${response.tracks.items.length} tracks`);
      return response.tracks.items;
    } catch (error: unknown) {
      console.error('[Search Tracks] Error searching tracks:', error);
      
      // Extract error message from various possible error formats
      let errorMessage = ERROR_MESSAGES.GENERIC_ERROR;
      if (error instanceof Error) {
        errorMessage = error.message || ERROR_MESSAGES.GENERIC_ERROR;
      } else if (typeof error === 'object' && error !== null) {
        const apiError = error as ApiError;
        errorMessage = apiError.message || 
                      apiError.error?.message || 
                      apiError.details?.errorMessage || 
                      ERROR_MESSAGES.GENERIC_ERROR;
      }
      
      setError(errorMessage);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { searchTracks, isLoading, error };
};

export default useSearchTracks;

