import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDebounce } from "use-debounce";
import { AxiosError } from "axios";

import { TrackItem } from "@/shared/types";
import { COOLDOWN_MS, INTERVAL_MS, DEBOUNCE_MS, MAX_PLAYLIST_LENGTH } from "@/shared/constants/trackSuggestion";
import { findSuggestedTrack } from "@/services/trackSuggestion";
import { useAddTrackToPlaylist } from "./useAddTrackToPlaylist";

interface UseAddSuggestedTrackToPlaylistProps {
  upcomingTracks: TrackItem[];
}

interface UseAddSuggestedTrackToPlaylistResult {
  isLoading: boolean;
  error: AxiosError | null;
}

export const useAddSuggestedTrackToPlaylist = ({ 
  upcomingTracks 
}: UseAddSuggestedTrackToPlaylistProps): UseAddSuggestedTrackToPlaylistResult => {
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

    // Guard clauses for early returns
    if (isRunningRef.current) {
      console.log("Already running — skipping duplicate call");
      return;
    }

    if (now - lastAddTimeRef.current < COOLDOWN_MS) {
      console.log("Still in cooldown period. Skipping suggestion.");
      return;
    }

    if (debouncedPlaylistLength > MAX_PLAYLIST_LENGTH) {
      console.log(`No need to add suggestion - playlist has more than ${MAX_PLAYLIST_LENGTH} tracks`);
      return;
    }

    isRunningRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const selectedTrack = await findSuggestedTrack(existingTrackIds);
      
      if (!selectedTrack) {
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

  // Effect for playlist length changes
  useEffect(() => {
    getAndAddSuggestedTrack();
  }, [debouncedPlaylistLength, getAndAddSuggestedTrack]);

  // Effect for 60-second interval
  useEffect(() => {
    const intervalId = setInterval(() => {
      getAndAddSuggestedTrack();
    }, INTERVAL_MS);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [getAndAddSuggestedTrack]);

  return {
    isLoading,
    error,
  };
};
