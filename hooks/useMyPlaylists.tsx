import useSWR from "swr";
import { sendApiRequest } from "../shared/api";
import { SpotifyPlaylists } from "@/shared/types";

export const useMyPlaylists = () => {
    const fetcher  = async () => {
        const response = await sendApiRequest<SpotifyPlaylists>({
            path: "me/playlists",
        });
        return response;
    }

    const { data, error, mutate } = useSWR("playlists", fetcher);

    return {
        data,
        isLoading: !error && !data,
        isError: error,
        refetchPlaylists: mutate,
    };
};
