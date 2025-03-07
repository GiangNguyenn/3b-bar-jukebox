import { sendApiRequest } from "@/shared/api";
import { SpotifyPlaybackState } from "@/shared/types";
import React from "react";
import useSWR from "swr";

const useNowPlayingTrack = () => {
  const fetcher = async () => {
    const response = await sendApiRequest<SpotifyPlaybackState>({
      path: "me/player/currently-playing",
    });
    return response;
  };

  const { data, error, mutate, isLoading } = useSWR("currently-playing-state", fetcher);

  return {
    data,
    isLoading: isLoading || error,
    isError: error,
    refetchPlaylists: mutate,
  };
};

export default useNowPlayingTrack;
