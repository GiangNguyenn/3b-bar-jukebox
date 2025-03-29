import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "@/shared/api";
import { formatDateForPlaylist } from "@/shared/utils/date";

const DAYS_TO_KEEP = 1; // Keep today's playlist, delete yesterday's and older

export interface UnfollowPlaylistResult {
  success: boolean;
  error?: string;
}

export const unfollowPlaylist = async (
  playlist: SpotifyPlaylistItem,
): Promise<UnfollowPlaylistResult> => {
  if (!playlist) {
    return { success: false, error: "No playlist provided" };
  }

  try {
    await sendApiRequest({
      path: `playlists/${playlist.id}/followers`,
      method: "DELETE",
    });
    return { success: true };
  } catch (err: any) {
    const errorMessage = err.response?.data?.error?.message || "Failed to unfollow playlist";
    return { success: false, error: errorMessage };
  }
};

export const cleanupOldPlaylists = async (playlists: SpotifyPlaylistItem[]): Promise<{
  success: boolean;
  unfollowedPlaylists: string[];
  error?: string;
}> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
    
    console.log(`[Cleanup] Processing playlists older than ${formatDateForPlaylist(cutoffDate)}`);

    const dailyMixPlaylists = playlists.filter(playlist => playlist.name.startsWith('Daily Mix - '));
    
    const playlistsWithDates = dailyMixPlaylists.map(playlist => {
      const dateStr = playlist.name.replace('Daily Mix - ', '');
      const [day, month, year] = dateStr.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      date.setHours(0, 0, 0, 0);
      return { ...playlist, date };
    });

    const oldPlaylists = playlistsWithDates.filter(playlist => playlist.date < cutoffDate);

    if (oldPlaylists.length > 0) {
      console.log(`[Cleanup] Found ${oldPlaylists.length} playlists to delete:`, 
        oldPlaylists.map(p => p.name).join(', '));
    } else {
      console.log('[Cleanup] No old playlists found to delete');
      return { success: true, unfollowedPlaylists: [] };
    }

    const unfollowedPlaylists: string[] = [];

    for (const playlist of oldPlaylists) {
      const result = await unfollowPlaylist(playlist);
      if (result.success) {
        console.log(`[Cleanup] Successfully deleted: ${playlist.name}`);
        unfollowedPlaylists.push(playlist.id);
      } else {
        console.error(`[Cleanup] Failed to delete ${playlist.name}:`, result.error);
      }
    }

    return {
      success: true,
      unfollowedPlaylists,
    };
  } catch (error) {
    console.error('[Cleanup] Error during playlist cleanup:', error);
    return {
      success: false,
      unfollowedPlaylists: [],
      error: error instanceof Error ? error.message : 'Unknown error during cleanup'
    };
  }
}; 