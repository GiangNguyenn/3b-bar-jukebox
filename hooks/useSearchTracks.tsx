import { useCallback, useState } from "react";
import { sendApiRequest } from "../shared/api";
import { TrackDetails } from "@/shared/types";
import { ERROR_MESSAGES, ErrorMessage } from "@/shared/constants/errors";
import { handleApiError, AppError } from "@/shared/utils/errorHandling";

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
  const [error, setError] = useState<ErrorMessage | null>(null);

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
    } catch (error) {
      const appError = handleApiError(error, 'Search Tracks');
      setError(appError.message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { searchTracks, isLoading, error };
};

export default useSearchTracks;

