import { TrackDetails } from "@/shared/types";
import { sendApiRequest } from "@/shared/api";
import { 
  FALLBACK_GENRES, 
  MIN_TRACK_POPULARITY, 
  SPOTIFY_SEARCH_ENDPOINT,
  TRACK_SEARCH_LIMIT 
} from "@/shared/constants/trackSuggestion";

// Utility: Select a random track from a filtered list
export function selectRandomTrack(
  tracks: TrackDetails[], 
  excludedIds: string[], 
  minPopularity: number
): TrackDetails | null {
  const candidates = tracks.filter(
    track =>
      !excludedIds.includes(track.id) &&
      track.popularity >= minPopularity
  );

  if (candidates.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

export async function searchTracksByGenre(genre: string): Promise<TrackDetails[]> {
  const response = await sendApiRequest<{ tracks: { items: TrackDetails[] } }>({
    path: `${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)}&type=track&limit=${TRACK_SEARCH_LIMIT}`,
    method: "GET",
  });

  const tracks = response.tracks?.items;
  if (!Array.isArray(tracks)) {
    throw new Error("Unexpected API response format");
  }

  return tracks;
}

export function getRandomGenre(): string {
  return FALLBACK_GENRES[Math.floor(Math.random() * FALLBACK_GENRES.length)];
}

export async function findSuggestedTrack(excludedTrackIds: string[]): Promise<TrackDetails | null> {
  const genre = getRandomGenre();
  console.log("Searching for tracks in genre:", genre);

  const tracks = await searchTracksByGenre(genre);
  const selectedTrack = selectRandomTrack(tracks, excludedTrackIds, MIN_TRACK_POPULARITY);

  if (!selectedTrack) {
    console.log("No suitable track suggestions found for genre:", genre);
    return null;
  }

  return selectedTrack;
} 