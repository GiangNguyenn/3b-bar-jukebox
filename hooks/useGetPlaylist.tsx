import useSWR from "swr";
import { sendApiRequest } from "../shared/api";
import { SpotifyPlaylistItem } from "@/shared/types";

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";

export const useGetPlaylist = (id: string) => {
    const fetcher  = async () => {
        const response = await sendApiRequest<SpotifyPlaylistItem>({
            path: `users/${userId}/playlists/${id}`,
        });
        return response;
    }

    const { data, error, mutate } = useSWR(`playlist ${id}`, fetcher);

    return {
        data,
        isLoading: !error && !data,
        isError: error,
        refetchPlaylist: mutate,
    };
};
