import { useCallback, useState } from "react";
import { sendApiRequest } from "../shared/api";
import { TrackDetails } from "@/shared/types";

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
  const [error, setError] = useState<Error | null>(null);

  const searchTracks = useCallback(async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendApiRequest<{ tracks: SpotifySearchResponse }>({
        path: `search?q=${query}&type=track&limit=20`,
        method: "GET",
      });

      return response.tracks.items;
    } catch (error) {
      setError(error as Error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { searchTracks, isLoading, error };
};

export default useSearchTracks;

