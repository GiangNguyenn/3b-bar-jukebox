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
  console.log(`\nSelecting random track from ${tracks.length} tracks`);
  console.log(`Excluded IDs: ${excludedIds.join(', ')}`);
  console.log(`Minimum popularity: ${minPopularity}`);

  const candidates = tracks.filter(
    track =>
      !excludedIds.includes(track.id) &&
      track.popularity >= minPopularity
  );

  console.log(`Found ${candidates.length} candidates after filtering`);
  if (candidates.length === 0) {
    console.log('No candidates found after filtering');
    return null;
  }

  const randomIndex = Math.floor(Math.random() * candidates.length);
  const selectedTrack = candidates[randomIndex];
  console.log('Selected track:', {
    name: selectedTrack.name,
    popularity: selectedTrack.popularity,
    artist: selectedTrack.artists[0].name
  });

  return selectedTrack;
}

export async function searchTracksByGenre(genre: string): Promise<TrackDetails[]> {
  // Use a more reliable search query that includes both genre and year
  const currentYear = new Date().getFullYear();
  const response = await sendApiRequest<{ tracks: { items: TrackDetails[] } }>({
    path: `${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)}&type=track&limit=${TRACK_SEARCH_LIMIT}&market=VN`,
    method: "GET",
  });

  const tracks = response.tracks?.items;
  if (!Array.isArray(tracks)) {
    throw new Error("Unexpected API response format");
  }

  console.log(`Found ${tracks.length} tracks in search results for genre: ${genre}`);
  return tracks;
}

export function getRandomGenre(): string {
  return FALLBACK_GENRES[Math.floor(Math.random() * FALLBACK_GENRES.length)];
}

export interface TrackSearchResult {
  track: TrackDetails | null;
  searchDetails: {
    attempts: number;
    totalTracksFound: number;
    excludedTrackIds: string[];
    minPopularity: number;
    genresTried: string[];
    trackDetails: Array<{
      name: string;
      popularity: number;
      isExcluded: boolean;
    }>;
  };
}

export async function findSuggestedTrack(excludedTrackIds: string[]): Promise<TrackSearchResult> {
  const MAX_GENRE_ATTEMPTS = 3;
  let attempts = 0;
  const genresTried: string[] = [];
  const allTrackDetails: Array<{ name: string; popularity: number; isExcluded: boolean }> = [];

  while (attempts < MAX_GENRE_ATTEMPTS) {
    const genre = getRandomGenre();
    genresTried.push(genre);
    console.log(`\nAttempt ${attempts + 1}/${MAX_GENRE_ATTEMPTS}: Searching for tracks in genre:`, genre);

    const tracks = await searchTracksByGenre(genre);
    
    // Log details about the tracks we found
    const trackDetails = tracks.map(t => ({
      name: t.name,
      popularity: t.popularity,
      isExcluded: excludedTrackIds.includes(t.id)
    }));
    allTrackDetails.push(...trackDetails);
    console.log('Track details:', trackDetails);

    const selectedTrack = selectRandomTrack(tracks, excludedTrackIds, MIN_TRACK_POPULARITY);

    if (selectedTrack) {
      console.log("Found suitable track:", {
        name: selectedTrack.name,
        popularity: selectedTrack.popularity,
        artist: selectedTrack.artists[0].name
      });
      return {
        track: selectedTrack,
        searchDetails: {
          attempts: attempts + 1,
          totalTracksFound: allTrackDetails.length,
          excludedTrackIds,
          minPopularity: MIN_TRACK_POPULARITY,
          genresTried,
          trackDetails: allTrackDetails
        }
      };
    }

    console.log(`No suitable track suggestions found for genre: ${genre}`);
    console.log(`Excluded track IDs: ${excludedTrackIds.join(', ')}`);
    console.log(`Minimum popularity required: ${MIN_TRACK_POPULARITY}`);
    
    attempts++;
    
    if (attempts < MAX_GENRE_ATTEMPTS) {
      console.log(`Trying another genre...`);
      // Add a small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`No suitable tracks found after trying ${MAX_GENRE_ATTEMPTS} genres`);
  return {
    track: null,
    searchDetails: {
      attempts,
      totalTracksFound: allTrackDetails.length,
      excludedTrackIds,
      minPopularity: MIN_TRACK_POPULARITY,
      genresTried,
      trackDetails: allTrackDetails
    }
  };
} 