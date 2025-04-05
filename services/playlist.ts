import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "@/shared/api";
import { ERROR_MESSAGES } from '@/shared/constants/errors';

export const getPlaylist = async (playlistId: string): Promise<SpotifyPlaylistItem> => {
  return sendApiRequest<SpotifyPlaylistItem>({
    path: `playlists/${playlistId}`,
  });
};

export const addTrackToPlaylist = async (playlistId: string, trackUri: string): Promise<void> => {
  if (!playlistId) {
    throw new Error(ERROR_MESSAGES.NO_PLAYLIST);
  }

  try {
    await sendApiRequest({
      path: `playlists/${playlistId}/tracks`,
      method: "POST",
      body: {
        uris: [trackUri]
      }
    });
  } catch (error) {
    console.error('[Playlist Service] Error adding track:', error);
    throw new Error(ERROR_MESSAGES.FAILED_TO_ADD);
  }
};

export const removeTrackFromPlaylist = async (playlistId: string, trackUri: string): Promise<void> => {
  if (!playlistId) {
    throw new Error(ERROR_MESSAGES.NO_PLAYLIST);
  }

  try {
    await sendApiRequest({
      path: `playlists/${playlistId}/tracks`,
      method: "DELETE",
      body: {
        tracks: [{ uri: trackUri }]
      }
    });
  } catch (error) {
    console.error('[Playlist Service] Error removing track:', error);
    throw new Error(ERROR_MESSAGES.FAILED_TO_REMOVE);
  }
}; 