import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "@/shared/api";

export const getPlaylist = async (playlistId: string): Promise<SpotifyPlaylistItem> => {
  return sendApiRequest<SpotifyPlaylistItem>({
    path: `playlists/${playlistId}`,
  });
};

export const addTrackToPlaylist = async (playlistId: string, trackUri: string): Promise<void> => {
  await sendApiRequest({
    path: `playlists/${playlistId}/tracks`,
    method: "POST",
    body: {
      uris: [trackUri]
    }
  });
};

export const removeTrackFromPlaylist = async (playlistId: string, trackUri: string): Promise<void> => {
  await sendApiRequest({
    path: `playlists/${playlistId}/tracks`,
    method: "DELETE",
    body: {
      tracks: [{ uri: trackUri }]
    }
  });
}; 