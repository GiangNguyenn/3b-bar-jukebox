import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "@/shared/api";
import { ERROR_MESSAGES, ErrorMessage } from "@/shared/constants/errors";
import useSWR from "swr";
import { handleApiError, handleOperationError } from "@/shared/utils/errorHandling";

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";

export const useGetPlaylist = (id: string) => {
    const fetcher = async () => {
        if (!id) return null;
        return sendApiRequest<SpotifyPlaylistItem>({
            path: `users/${userId}/playlists/${id}`,
        });
    };

    const { data, error, mutate } = useSWR(`playlist-${id}`, fetcher);

    const refetchPlaylist = async () => {
        console.log('[Get Playlist] Refetching playlist...');
        await handleOperationError(
            async () => {
                await mutate(async () => {
                    const newData = await sendApiRequest<SpotifyPlaylistItem>({
                        path: `users/${userId}/playlists/${id}`,
                    });
                    return newData;
                }, {
                    revalidate: false,
                    populateCache: true,
                    rollbackOnError: true,
                });
                console.log('[Get Playlist] Playlist refetched successfully');
            },
            'Get Playlist'
        );
    };

    return {
        data,
        isLoading: !error && !data,
        isError: error,
        refetchPlaylist,
    };
};
