import { useEffect, useState, useCallback } from "react";
import { SpotifyPlaylistItem } from "@/shared/types";
import { useMyPlaylists } from "./useMyPlaylists";
import { useUnfollowPlaylist } from "./useUnfollowPlaylist";
import { formatDateForPlaylist } from "@/shared/utils/date";

const DAYS_TO_KEEP = 1; // Keep today's playlist, delete yesterday's and older

interface PlaylistWithDate extends SpotifyPlaylistItem {
  date: Date;
}

export const useUnfollowOldPlaylists = () => {
  const [unfollowedPlaylists, setUnfollowedPlaylists] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [currentPlaylistIndex, setCurrentPlaylistIndex] = useState(0);
  
  const {
    data: playlists,
    isError,
    isLoading,
    refetchPlaylists,
  } = useMyPlaylists();

  // Parse playlist dates and filter old ones
  const getOldPlaylists = useCallback(() => {
    if (!playlists?.items) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
    
    console.log(`[Unfollow] Processing playlists older than ${formatDateForPlaylist(cutoffDate)}`);

    const dailyMixPlaylists = playlists.items.filter(playlist => playlist.name.startsWith('Daily Mix - '));

    const playlistsWithDates = dailyMixPlaylists.map(playlist => {
      const dateStr = playlist.name.replace('Daily Mix - ', '');
      const [day, month, year] = dateStr.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      date.setHours(0, 0, 0, 0);
      return { ...playlist, date };
    });

    const oldPlaylists = playlistsWithDates
      .filter(playlist => playlist.date < cutoffDate)
      .filter(playlist => !unfollowedPlaylists.has(playlist.id));

    if (oldPlaylists.length > 0) {
      console.log(`[Unfollow] Found ${oldPlaylists.length} playlists to delete:`, 
        oldPlaylists.map(p => p.name).join(', '));
    }

    return oldPlaylists;
  }, [playlists?.items, unfollowedPlaylists]);

  // Get the current playlist to process
  const oldPlaylists = getOldPlaylists();
  const currentPlaylist = oldPlaylists[currentPlaylistIndex] || null;
  
  // Use the unfollow hook for the current playlist
  const { unfollowPlaylist } = useUnfollowPlaylist(currentPlaylist);

  // Process the current playlist
  const processCurrentPlaylist = useCallback(async () => {
    if (!currentPlaylist) {
      console.log('[Unfollow] Finished processing all playlists');
      setIsProcessing(false);
      setHasRun(true);
      return;
    }

    try {
      const result = await unfollowPlaylist({
        onSuccess: () => {
          console.log(`[Unfollow] Successfully deleted: ${currentPlaylist.name}`);
          setUnfollowedPlaylists(prev => {
            const newSet = new Set(prev);
            newSet.add(currentPlaylist.id);
            return newSet;
          });
          setCurrentPlaylistIndex(prev => prev + 1);
        },
        onError: (error) => {
          console.error(`[Unfollow] Failed to delete ${currentPlaylist.name}:`, error.message);
          // Don't increment index on error, try again
          setIsProcessing(false);
        }
      });

      if (!result.success) {
        console.error(`[Unfollow] Failed to delete ${currentPlaylist.name}:`, result.error);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error(`[Unfollow] Error processing ${currentPlaylist.name}:`, error);
      setIsProcessing(false);
    }
  }, [currentPlaylist, unfollowPlaylist]);

  // Start processing when playlists are loaded
  useEffect(() => {
    if (!isLoading && playlists?.items && !hasRun && !isProcessing) {
      setIsProcessing(true);
      processCurrentPlaylist();
    }
  }, [isLoading, playlists?.items, hasRun, isProcessing, processCurrentPlaylist]);

  return {
    isProcessing,
    isLoading,
    isError,
    unfollowedPlaylists: Array.from(unfollowedPlaylists),
  };
}; 