import { TrackDetails } from "@/shared/types";
import { sendApiRequest } from "@/shared/api";
import { 
  FALLBACK_GENRES, 
  MIN_TRACK_POPULARITY, 
  SPOTIFY_SEARCH_ENDPOINT,
  TRACK_SEARCH_LIMIT,
  DEFAULT_MARKET
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

  const candidates = tracks.filter(track => {
    const isExcluded = excludedIds.includes(track.id);
    const meetsPopularity = track.popularity >= minPopularity;
    const isPlayable = track.is_playable === true;
    
    if (!isPlayable) {
      console.log(`Track "${track.name}" is not playable in current market`);
    }
    if (isExcluded) {
      console.log(`Track "${track.name}" is excluded`);
    }
    if (!meetsPopularity) {
      console.log(`Track "${track.name}" does not meet popularity threshold (${track.popularity} < ${minPopularity})`);
    }

    return !isExcluded && meetsPopularity && isPlayable;
  });

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
    artist: selectedTrack.artists[0].name,
    isPlayable: selectedTrack.is_playable
  });

  return selectedTrack;
}

export async function searchTracksByGenre(genre: string, market: string = DEFAULT_MARKET): Promise<TrackDetails[]> {
  try {
    const currentYear = new Date().getFullYear();
    const response = await sendApiRequest<{ tracks: { items: TrackDetails[] } }>({
      path: `${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)}&type=track&limit=${TRACK_SEARCH_LIMIT}&market=${market}`,
      method: "GET",
    });

    const tracks = response.tracks?.items;
    if (!Array.isArray(tracks)) {
      throw new Error("Unexpected API response format");
    }

    console.log(`Found ${tracks.length} tracks in search results for genre: ${genre} in market: ${market}`);
    return tracks;
  } catch (error) {
    console.error(`Error searching tracks for genre ${genre}:`, error);
    throw error;
  }
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
      isPlayable: boolean;
    }>;
  };
}

export async function findSuggestedTrack(
  excludedTrackIds: string[], 
  currentTrackId?: string | null,
  market: string = DEFAULT_MARKET
): Promise<TrackSearchResult> {
  const MAX_GENRE_ATTEMPTS = 3;
  let attempts = 0;
  const genresTried: string[] = [];
  const allTrackDetails: Array<{ name: string; popularity: number; isExcluded: boolean; isPlayable: boolean }> = [];
  
  // Add current track to excluded IDs if provided
  const allExcludedIds = currentTrackId 
    ? [...excludedTrackIds, currentTrackId]
    : excludedTrackIds;

  while (attempts < MAX_GENRE_ATTEMPTS) {
    const genre = getRandomGenre();
    genresTried.push(genre);
    console.log(`\nAttempt ${attempts + 1}/${MAX_GENRE_ATTEMPTS}: Searching for tracks in genre:`, genre);

    try {
      const tracks = await searchTracksByGenre(genre, market);
      
      // Log details about the tracks we found
      const trackDetails = tracks.map(t => ({
        name: t.name,
        popularity: t.popularity,
        isExcluded: allExcludedIds.includes(t.id),
        isPlayable: t.is_playable
      }));
      allTrackDetails.push(...trackDetails);
      console.log('Track details:', trackDetails);

      const selectedTrack = selectRandomTrack(tracks, allExcludedIds, MIN_TRACK_POPULARITY);

      if (selectedTrack) {
        console.log("Found suitable track:", {
          name: selectedTrack.name,
          popularity: selectedTrack.popularity,
          artist: selectedTrack.artists[0].name,
          isPlayable: selectedTrack.is_playable
        });
        return {
          track: selectedTrack,
          searchDetails: {
            attempts: attempts + 1,
            totalTracksFound: allTrackDetails.length,
            excludedTrackIds: allExcludedIds,
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
    } catch (error) {
      console.error(`Error during track search attempt ${attempts + 1}:`, error);
      attempts++;
      if (attempts >= MAX_GENRE_ATTEMPTS) {
        throw error;
      }
    }
  }

  console.log(`No suitable tracks found after trying ${MAX_GENRE_ATTEMPTS} genres`);
  return {
    track: null,
    searchDetails: {
      attempts,
      totalTracksFound: allTrackDetails.length,
      excludedTrackIds: allExcludedIds,
      minPopularity: MIN_TRACK_POPULARITY,
      genresTried,
      trackDetails: allTrackDetails
    }
  };
} 