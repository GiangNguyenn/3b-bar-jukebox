import useSWR from "swr";
import { sendApiRequest } from "../shared/api";
import { SpotifyPlaylistItem } from "@/shared/types";

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";

export const useGetPlaylist = (id: string) => {
    const fetcher = async () => {
        console.log('Fetching playlist data for ID:', id);
        const response = await sendApiRequest<SpotifyPlaylistItem>({
            path: `users/${userId}/playlists/${id}`,
        });
        console.log('Playlist data fetched:', response);
        return response;
    }

    const { data, error, mutate } = useSWR(`playlist ${id}`, fetcher, {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    });

    const refetchPlaylist = async () => {
        console.log('Refetching playlist...');
        try {
            await mutate();
            console.log('Playlist refetched successfully');
        } catch (error) {
            console.error('Error refetching playlist:', error);
        }
    };

    return {
        data,
        isLoading: !error && !data,
        isError: error,
        refetchPlaylist,
    };
};
