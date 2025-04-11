import {
  SpotifyPlaylistItem,
  SpotifyPlaybackState,
  TrackItem,
} from "@/shared/types";
import { sendApiRequest } from "@/shared/api";
import { handleOperationError } from "@/shared/utils/errorHandling";

export interface SpotifyApiClient {
  getPlaylists(): Promise<{ items: SpotifyPlaylistItem[] }>;
  getPlaylist(playlistId: string): Promise<SpotifyPlaylistItem>;
  getCurrentlyPlaying(): Promise<SpotifyPlaybackState>;
  addTrackToPlaylist(playlistId: string, trackUri: string): Promise<void>;
  getPlaybackState(): Promise<SpotifyPlaybackState>;
  getQueue(): Promise<{ queue: SpotifyPlaybackState[] }>;
}

export class SpotifyApiService implements SpotifyApiClient {
  private static instance: SpotifyApiService;

  private constructor(private readonly apiClient = sendApiRequest) {}

  public static getInstance(): SpotifyApiService {
    if (!SpotifyApiService.instance) {
      SpotifyApiService.instance = new SpotifyApiService();
    }
    return SpotifyApiService.instance;
  }

  async getPlaylists(): Promise<{ items: SpotifyPlaylistItem[] }> {
    return handleOperationError(
      async () =>
        this.apiClient<{ items: SpotifyPlaylistItem[] }>({
          path: "me/playlists",
        }),
      "SpotifyApi.getPlaylists",
    );
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylistItem> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlaylistItem>({
          path: `playlists/${playlistId}`,
        }),
      "SpotifyApi.getPlaylist",
    );
  }

  async getCurrentlyPlaying(): Promise<SpotifyPlaybackState> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlaybackState>({
          path: "me/player/currently-playing",
        }),
      "SpotifyApi.getCurrentlyPlaying",
    );
  }

  async addTrackToPlaylist(
    playlistId: string,
    trackUri: string,
  ): Promise<void> {
    const formattedUri = trackUri.startsWith("spotify:track:")
      ? trackUri
      : `spotify:track:${trackUri}`;

    return handleOperationError(
      async () =>
        this.apiClient({
          path: `playlists/${playlistId}/tracks`,
          method: "POST",
          body: {
            uris: [formattedUri],
          },
        }),
      "SpotifyApi.addTrackToPlaylist",
    );
  }

  async getPlaybackState(): Promise<SpotifyPlaybackState> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlaybackState>({
          path: "me/player",
        }),
      "SpotifyApi.getPlaybackState",
    );
  }

  async getQueue(): Promise<{ queue: SpotifyPlaybackState[] }> {
    return handleOperationError(
      async () =>
        this.apiClient<{ queue: SpotifyPlaybackState[] }>({
          path: "me/player/queue",
        }),
      "SpotifyApi.getQueue",
    );
  }
}
