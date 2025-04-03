import { SpotifyPlaylistItem, TrackItem } from "@/shared/types";
import { ERROR_MESSAGES, ErrorMessage } from "@/shared/constants/errors";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { sendApiRequest } from "@/shared/api";

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? "";

export const useGetPlaylist = (id: string) => {
    const fetcher = async () => {
        try {
            console.log('[Get Playlist] Fetching playlist data for ID:', id);
            const response = await sendApiRequest<SpotifyPlaylistItem>({
                path: `users/${userId}/playlists/${id}`,
            });
            console.log('[Get Playlist] Playlist data fetched successfully');
            return response;
        } catch (error: unknown) {
            console.error('[Get Playlist] Error fetching playlist:', error);
            
            // Extract error message from various possible error formats
            let errorMessage: ErrorMessage = ERROR_MESSAGES.FAILED_TO_LOAD;
            if (error instanceof Error) {
                errorMessage = (error.message || ERROR_MESSAGES.FAILED_TO_LOAD) as ErrorMessage;
            } else if (typeof error === 'object' && error !== null) {
                const apiError = error as { message?: string; error?: { message?: string }; details?: { errorMessage?: string } };
                const message = apiError.message || 
                              apiError.error?.message || 
                              apiError.details?.errorMessage;
                errorMessage = (message || ERROR_MESSAGES.FAILED_TO_LOAD) as ErrorMessage;
            }
            
            throw new Error(errorMessage);
        }
    }

    const { data, error, mutate } = useSWR(`playlist ${id}`, fetcher, {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false,
        refreshInterval: 30000 // Check every 30 seconds
    });

    const refetchPlaylist = async () => {
        console.log('[Get Playlist] Refetching playlist...');
        try {
            // Use optimistic update to prevent full re-render
            await mutate(async () => {
                const newData = await sendApiRequest<SpotifyPlaylistItem>({
                    path: `users/${userId}/playlists/${id}`,
                });
                return newData;
            }, {
                revalidate: false, // Don't trigger a revalidation
                populateCache: true, // Update the cache with the new data
                rollbackOnError: true, // Rollback if the request fails
            });
            console.log('[Get Playlist] Playlist refetched successfully');
        } catch (error: unknown) {
            console.error('[Get Playlist] Error refetching playlist:', error);
            
            // Extract error message from various possible error formats
            let errorMessage: ErrorMessage = ERROR_MESSAGES.FAILED_TO_LOAD;
            if (error instanceof Error) {
                errorMessage = (error.message || ERROR_MESSAGES.FAILED_TO_LOAD) as ErrorMessage;
            } else if (typeof error === 'object' && error !== null) {
                const apiError = error as { message?: string; error?: { message?: string }; details?: { errorMessage?: string } };
                const message = apiError.message || 
                              apiError.error?.message || 
                              apiError.details?.errorMessage;
                errorMessage = (message || ERROR_MESSAGES.FAILED_TO_LOAD) as ErrorMessage;
            }
            
            throw new Error(errorMessage);
        }
    };

    return {
        data,
        isLoading: !error && !data,
        isError: error,
        refetchPlaylist,
    };
};
