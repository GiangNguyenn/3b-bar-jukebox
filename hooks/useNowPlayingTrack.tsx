import { sendApiRequest } from "@/shared/api";
import { SpotifyPlaybackState } from "@/shared/types";
import React from "react";
import useSWR from "swr";

const useNowPlayingTrack = () => {
  const fetcher = async () => {
    console.log('[useNowPlayingTrack] Fetching current track');
    const response = await sendApiRequest<SpotifyPlaybackState>({
      path: "me/player/currently-playing",
    });
    console.log('[useNowPlayingTrack] Current track:', response?.item?.id);
    return response;
  };

  const { data, error, mutate, isLoading } = useSWR("currently-playing-state", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshInterval: 10000, // Check every 10 seconds
  });

  return {
    data,
    isLoading: isLoading || error,
    isError: error,
    refetchPlaylists: mutate,
  };
};

export default useNowPlayingTrack;
