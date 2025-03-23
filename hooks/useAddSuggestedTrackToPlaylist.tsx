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

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

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

  const shouldSkipSuggestion = useCallback((now: number): boolean => {
    if (isRunningRef.current) {
      console.log("Already running — skipping duplicate call");
      return true;
    }

    if (now - lastAddTimeRef.current < COOLDOWN_MS) {
      console.log("Still in cooldown period. Skipping suggestion.");
      return true;
    }

    if (debouncedPlaylistLength > MAX_PLAYLIST_LENGTH) {
      console.log(`No need to add suggestion - playlist has more than ${MAX_PLAYLIST_LENGTH} tracks`);
      return true;
    }

    return false;
  }, [debouncedPlaylistLength]);

  const waitForRetry = useCallback(async (retryCount: number): Promise<void> => {
    if (retryCount < MAX_RETRIES) {
      console.log(`Waiting ${RETRY_DELAY_MS}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }, []);

  const tryAddTrack = useCallback(async (trackUri: string): Promise<boolean> => {
    const result = await addTrack(trackUri);
    
    if (result.success) {
      return true;
    }

    // If track exists, return false to trigger a retry
    if (result.reason === 'TRACK_EXISTS') {
      return false;
    }

    // For other failures, throw an error
    throw new Error(`Failed to add track: ${result.reason}`);
  }, [addTrack]);

  const handleTrackSuggestion = useCallback(async (retryCount: number): Promise<boolean> => {
    const selectedTrack = await findSuggestedTrack(existingTrackIds);
    
    if (!selectedTrack) {
      console.log(`No suitable track suggestions found (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      return false;
    }

    console.log(`Attempting to add suggested track: ${selectedTrack.name} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    return await tryAddTrack(selectedTrack.uri);
  }, [existingTrackIds, tryAddTrack]);

  const getAndAddSuggestedTrack = useCallback(async () => {
    const now = Date.now();

    if (shouldSkipSuggestion(now)) {
      return;
    }

    isRunningRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      let retryCount = 0;
      let success = false;

      while (!success && retryCount < MAX_RETRIES) {
        success = await handleTrackSuggestion(retryCount);
        
        if (!success) {
          console.log(`Track already exists or no suitable track found, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          retryCount++;
          await waitForRetry(retryCount);
        }
      }

      if (success) {
        lastAddTimeRef.current = Date.now();
      } else {
        throw new Error("Failed to add a track after multiple attempts");
      }
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
  }, [shouldSkipSuggestion, handleTrackSuggestion, waitForRetry, upcomingTracks.length]);

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
