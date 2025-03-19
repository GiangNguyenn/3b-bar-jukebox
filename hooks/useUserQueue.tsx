import useSWR from "swr";
import { sendApiRequest } from "../shared/api";
import { UserQueue } from "@/shared/types";

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";

export const useUserQueue = (id: string) => {
  const fetcher = async () => {
    const response = await sendApiRequest<UserQueue>({
      path: `me/player/queue`,
    });
    return response;
  };

  const { data, error, mutate } = useSWR(`playlist ${id}`, fetcher);

  return {
    data,
    isLoading: !error && !data,
    isError: error,
    refetchPlaylist: mutate,
  };
};
