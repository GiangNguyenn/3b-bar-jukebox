import { SpotifyPlaylistItem, TrackItem, SpotifyPlaybackState } from "@/shared/types";
import { SpotifyApiClient, SpotifyApiService } from "./spotifyApi";
import { COOLDOWN_MS, MAX_PLAYLIST_LENGTH } from "@/shared/constants/trackSuggestion";
import { findSuggestedTrack } from "@/services/trackSuggestion";
import { filterUpcomingTracks } from "@/lib/utils";
import { autoRemoveTrack } from '@/shared/utils/autoRemoveTrack';
import { handleOperationError } from "@/shared/utils/errorHandling";

export interface PlaylistRefreshService {
  refreshPlaylist(force?: boolean): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
    diagnosticInfo?: Record<string, unknown>;
    forceRefresh?: boolean;
  }>;
  getUpcomingTracks(playlist: SpotifyPlaylistItem, currentTrackId: string | null): TrackItem[];
  autoRemoveFinishedTrack(params: {
    playlistId: string;
    currentTrackId: string | null;
    playlistTracks: TrackItem[];
    playbackState: SpotifyPlaybackState | null;
  }): Promise<boolean>;
}

export class PlaylistRefreshServiceImpl implements PlaylistRefreshService {
  private static instance: PlaylistRefreshServiceImpl;
  private lastAddTime = 0;
  private readonly FIXED_PLAYLIST_NAME = "3B Saigon";
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  private constructor(
    private readonly spotifyApi: SpotifyApiClient = SpotifyApiService.getInstance()
  ) {}

  public static getInstance(): PlaylistRefreshServiceImpl {
    if (!PlaylistRefreshServiceImpl.instance) {
      PlaylistRefreshServiceImpl.instance = new PlaylistRefreshServiceImpl();
    }
    return PlaylistRefreshServiceImpl.instance;
  }

  // For testing purposes only
  public static resetInstance(): void {
    PlaylistRefreshServiceImpl.instance = undefined as any;
  }

  private async getFixedPlaylist(): Promise<SpotifyPlaylistItem | null> {
    const playlists = await this.spotifyApi.getPlaylists();
    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === this.FIXED_PLAYLIST_NAME
    );

    if (!fixedPlaylist) {
      return null;
    }

    return this.spotifyApi.getPlaylist(fixedPlaylist.id);
  }

  private async getCurrentlyPlaying(): Promise<{ id: string | null; error?: string }> {
    try {
      const response = await this.spotifyApi.getCurrentlyPlaying();
      return { id: response.item?.id ?? null };
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        return { id: null, error: 'Spotify authentication failed. Please check your access token.' };
      }
      return { id: null };
    }
  }

  private async tryAddTrack(trackUri: string, playlistId: string): Promise<boolean> {
    try {
      await this.spotifyApi.addTrackToPlaylist(playlistId, trackUri);
      return true;
    } catch (error) {
      throw error;
    }
  }

  private async addSuggestedTrackToPlaylist(
    upcomingTracks: TrackItem[],
    playlistId: string,
    currentTrackId: string | null,
    allPlaylistTracks: TrackItem[]
  ): Promise<{ success: boolean; error?: string; searchDetails?: unknown }> {
    const existingTrackIds = allPlaylistTracks.map(t => t.track.id);
    const now = Date.now();
    
    if (now - this.lastAddTime < COOLDOWN_MS) {
      return { success: false, error: "In cooldown period" };
    }

    if (upcomingTracks.length > MAX_PLAYLIST_LENGTH) {
      return { success: false, error: "Playlist too long" };
    }

    try {
      let retryCount = 0;
      let success = false;
      let searchDetails: unknown;

      while (!success && retryCount < this.MAX_RETRIES) {
        const result = await findSuggestedTrack(existingTrackIds, currentTrackId);
        
        if (!result.track) {
          retryCount++;
          continue;
        }

        success = await this.tryAddTrack(result.track.uri, playlistId);
        searchDetails = result.searchDetails;
        
        if (!success) {
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * Math.pow(2, retryCount)));
        }
      }

      if (success) {
        this.lastAddTime = now;
        return { success: true, searchDetails };
      }

      return { success: false, error: "Failed to add track after retries" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  getUpcomingTracks(playlist: SpotifyPlaylistItem, currentTrackId: string | null): TrackItem[] {
    return filterUpcomingTracks(playlist.tracks.items, currentTrackId);
  }

  async autoRemoveFinishedTrack(params: {
    playlistId: string;
    currentTrackId: string | null;
    playlistTracks: TrackItem[];
    playbackState: SpotifyPlaybackState | null;
  }): Promise<boolean> {
    return handleOperationError(
      async () => autoRemoveTrack({
        ...params,
        onSuccess: () => {
          console.log('[PlaylistRefresh] Successfully removed finished track');
        },
        onError: (error) => {
          console.error('[PlaylistRefresh] Error removing finished track:', error);
        }
      }),
      'PlaylistRefresh.autoRemoveFinishedTrack'
    );
  }

  async refreshPlaylist(force = false): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
    diagnosticInfo?: Record<string, unknown>;
    forceRefresh?: boolean;
  }> {
    try {
      const playlist = await this.getFixedPlaylist();
      
      if (!playlist) {
        return {
          success: false,
          message: `No playlist found with name: ${this.FIXED_PLAYLIST_NAME}`,
          timestamp: new Date().toISOString()
        };
      }

      const { id: currentTrackId, error: playbackError } = await this.getCurrentlyPlaying();
      
      if (playbackError) {
        return {
          success: false,
          message: playbackError,
          timestamp: new Date().toISOString()
        };
      }
      
      const upcomingTracks = this.getUpcomingTracks(playlist, currentTrackId);
      
      const playbackState = await this.spotifyApi.getPlaybackState();
      const removedTrack = await this.autoRemoveFinishedTrack({
        playlistId: playlist.id,
        currentTrackId,
        playlistTracks: playlist.tracks.items,
        playbackState
      });
      
      const diagnosticInfo = {
        currentTrackId,
        totalTracks: playlist.tracks.items.length,
        upcomingTracksCount: upcomingTracks.length,
        playlistTrackIds: playlist.tracks.items.map(t => t.track.id),
        upcomingTrackIds: upcomingTracks.map(t => t.track.id),
        removedTrack
      };
      
      const result = await this.addSuggestedTrackToPlaylist(
        upcomingTracks,
        playlist.id,
        currentTrackId,
        playlist.tracks.items
      );
      
      if (!result.success) {
        return {
          success: true,
          message: result.error === "Playlist too long" 
            ? `Playlist has reached maximum length of ${MAX_PLAYLIST_LENGTH} tracks. No new tracks needed.`
            : result.error || "Failed to add track",
          timestamp: new Date().toISOString(),
          diagnosticInfo,
          forceRefresh: force
        };
      }

      return {
        success: true,
        message: 'Track added successfully',
        timestamp: new Date().toISOString(),
        diagnosticInfo,
        forceRefresh: force
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      };
    }
  }
} 