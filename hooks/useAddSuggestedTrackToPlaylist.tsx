import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDebounce } from "use-debounce";
import { AxiosError } from "axios";

import { sendApiRequest } from "@/shared/api";
import { TrackDetails, TrackItem } from "@/shared/types";
import useNowPlayingTrack from "./useNowPlayingTrack";
import { useAddTrackToPlaylist } from "./useAddTrackToPlaylist";

interface UseAddSuggestedTrackToPlaylistProps {
  upcomingTracks: TrackItem[];
}

// Constants
const COOLDOWN_MS = 10000;

// 0–30: Very obscure / niche
// 30–50: Mid-tier popularity — known, but not hits
// 50–70: Popular, frequently streamed
// 70–90: Very popular — likely to be hits or viral tracks
// 90–100: Global megahits 
const MIN_TRACK_POPULARITY = 50;  

const DEBOUNCE_MS = 10000;
const SPOTIFY_SEARCH_ENDPOINT = "search";

const FALLBACK_GENRES = [
  "Australian Alternative Rock",
  "Australian Rock",
  "Vietnamese Pop",
  "Blues-rock",
  "Contemporary Jazz",
  "Classic Rock",
  "Rock",
  "Indie Rock"
];

// Utility: Select a random track from a filtered list
function selectRandomTrack(tracks: TrackDetails[], excludedIds: string[], minPopularity: number): TrackDetails | null {
  const candidates = tracks.filter(
    track =>
      !excludedIds.includes(track.id) &&
      track.popularity >= minPopularity
  );

  if (candidates.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

export const useAddSuggestedTrackToPlaylist = ({ upcomingTracks }: UseAddSuggestedTrackToPlaylistProps) => {
  const { data: nowPlaying } = useNowPlayingTrack(); // Currently unused
  const { addTrack } = useAddTrackToPlaylist();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AxiosError | null>(null);

  // Debounced version of upcoming track count
  const [debouncedPlaylistLength] = useDebounce(upcomingTracks.length, DEBOUNCE_MS);

  // Memorized list of existing track IDs to reduce deps
  const existingTrackIds = useMemo(() => upcomingTracks.map(t => t.track.id), [upcomingTracks]);

  // Cooldown and concurrency protection
  const lastAddTimeRef = useRef<number>(0);
  const isRunningRef = useRef<boolean>(false);

  const getAndAddSuggestedTrack = useCallback(async () => {
    const now = Date.now();

    if (isRunningRef.current) {
      console.log("Already running — skipping duplicate call");
      return;
    }

    if (now - lastAddTimeRef.current < COOLDOWN_MS) {
      console.log("Still in cooldown period. Skipping suggestion.");
      return;
    }

    if (debouncedPlaylistLength > 2) {
      console.log("No need to add suggestion - playlist has more than 2 tracks");
      return;
    }

    isRunningRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const genre = FALLBACK_GENRES[Math.floor(Math.random() * FALLBACK_GENRES.length)];
      console.log("Searching for tracks in genre:", genre);

      const response = await sendApiRequest<{ tracks: { items: TrackDetails[] } }>({
        path: `${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)}&type=track&limit=50`,
        method: "GET",
      });

      const tracks = response.tracks?.items;
      if (!Array.isArray(tracks)) {
        console.warn("Unexpected API response format");
        return;
      }

      const selectedTrack = selectRandomTrack(tracks, existingTrackIds, MIN_TRACK_POPULARITY);

      if (!selectedTrack) {
        console.log("No suitable track suggestions found for genre:", genre);
        return;
      }

      console.log("Adding suggested track:", selectedTrack.name);
      await addTrack(selectedTrack.uri);
      lastAddTimeRef.current = Date.now();
    } catch (err: any) {
      console.error("Error getting/adding suggestion:", {
        error: err,
        upcomingTracksLength: upcomingTracks.length,
      });
      setError(err as AxiosError);
    } finally {
      setIsLoading(false);
      isRunningRef.current = false;
    }
  }, [addTrack, debouncedPlaylistLength, existingTrackIds]);

  useEffect(() => {
    getAndAddSuggestedTrack();
  }, [debouncedPlaylistLength, getAndAddSuggestedTrack]);

  return {
    isLoading,
    error,
  };
};
