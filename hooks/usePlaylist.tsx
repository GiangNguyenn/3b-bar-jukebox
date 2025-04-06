import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SpotifyPlaylistItem, TrackItem, SpotifyPlaybackState } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { filterUpcomingTracks } from '@/lib/utils';
import useSWR from 'swr';
import { sendApiRequest } from '@/shared/api';
import { handleOperationError, AppError } from '@/shared/utils/errorHandling';

const fetcher = async (playlistId: string) => {
  if (!playlistId) return null;
  
  return handleOperationError(
    async () => {
      console.log(`[Playlist] Fetching playlist: ${playlistId}`);
      const result = await sendApiRequest<SpotifyPlaylistItem>({
        path: `playlists/${playlistId}`,
      });
      console.log(`[Playlist] Successfully fetched playlist: ${playlistId}`);
      return result;
    },
    'PlaylistFetcher',
    (error) => {
      console.error(`[Playlist] Error fetching playlist ${playlistId}:`, error);
    }
  );
};

const currentlyPlayingFetcher = async () => {
  return handleOperationError(
    async () => {
      console.log('[Playlist] Fetching currently playing track');
      const result = await sendApiRequest<SpotifyPlaybackState>({
        path: "me/player/currently-playing",
      });
      console.log('[Playlist] Successfully fetched currently playing track');
      return result;
    },
    'CurrentlyPlayingFetcher',
    (error) => {
      console.error('[Playlist] Error fetching currently playing track:', error);
    }
  );
};

export const usePlaylist = (playlistId: string | null) => {
  const { data: playlist, error, mutate: refreshPlaylist } = useSWR(
    playlistId ? `playlist-${playlistId}` : null,
    () => fetcher(playlistId ?? ''),
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  // Get currently playing track
  const { data: playbackState } = useSWR(
    'currently-playing-state',
    currentlyPlayingFetcher,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  // Filter upcoming tracks
  const upcomingTracks = useMemo(() => {
    if (!playlist || !playbackState?.item?.id) return [];
    return filterUpcomingTracks(playlist.tracks.items, playbackState.item.id);
  }, [playlist, playbackState?.item?.id]);

  const handleRefresh = useCallback(async () => {
    try {
      console.log(`[Playlist] Refreshing playlist: ${playlistId}`);
      await refreshPlaylist();
      console.log(`[Playlist] Successfully refreshed playlist: ${playlistId}`);
    } catch (error) {
      console.error(`[Playlist] Error refreshing playlist ${playlistId}:`, error);
      throw error;
    }
  }, [refreshPlaylist, playlistId]);

  return {
    playlist,
    upcomingTracks,
    isLoading: !error && !playlist,
    error: error ? (error instanceof AppError ? error : new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, error, 'usePlaylist')) : null,
    refreshPlaylist: handleRefresh
  };
}; 