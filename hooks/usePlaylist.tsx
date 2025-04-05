import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SpotifyPlaylistItem, TrackItem, SpotifyPlaybackState } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { filterUpcomingTracks } from '@/lib/utils';
import useSWR from 'swr';
import { sendApiRequest } from '@/shared/api';

const fetcher = async (playlistId: string) => {
  if (!playlistId) return null;
  return sendApiRequest<SpotifyPlaylistItem>({
    path: `playlists/${playlistId}`,
  });
};

const currentlyPlayingFetcher = async () => {
  return sendApiRequest<SpotifyPlaybackState>({
    path: "me/player/currently-playing",
  });
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
    await refreshPlaylist();
  }, [refreshPlaylist]);

  return {
    playlist,
    upcomingTracks,
    isLoading: !error && !playlist,
    error: error ? ERROR_MESSAGES.FAILED_TO_LOAD : null,
    refreshPlaylist: handleRefresh
  };
}; 