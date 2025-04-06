import { useCallback, useState } from "react";
import { sendApiRequest } from "../shared/api";
import { TrackDetails } from "@/shared/types";
import { ERROR_MESSAGES } from "@/shared/constants/errors";
import { handleApiError, handleOperationError, AppError } from "@/shared/utils/errorHandling";

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
  const [error, setError] = useState<AppError | null>(null);

  const searchTracks = useCallback(async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await handleOperationError(
        async () => {
          const result = await sendApiRequest<{ tracks: SpotifySearchResponse }>({
            path: `search?q=${query}&type=track&limit=20`,
            method: "GET",
          });
          
          if (!result.tracks?.items) {
            throw new AppError(ERROR_MESSAGES.MALFORMED_RESPONSE, 'SearchTracks');
          }
          
          return result.tracks.items;
        },
        'SearchTracks',
        (error) => {
          console.error('[Search Tracks] Error during search:', error);
          setError(error);
        }
      );

      return response ?? [];
    } catch (error) {
      // Error is already handled by handleOperationError
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { searchTracks, isLoading, error };
};

export default useSearchTracks;

