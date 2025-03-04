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

const useSearchTracks = async (query: string) => {
  try {
    const response = await sendApiRequest<{ tracks: SpotifySearchResponse }>({
      path: `search?q=${query}&type=track&limit=20`,
      method: "GET",
    });
    return response.tracks.items;
  } catch (error) {
    throw error;
  }
};

export default useSearchTracks;
