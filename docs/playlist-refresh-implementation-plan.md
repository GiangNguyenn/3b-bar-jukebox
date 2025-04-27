# Playlist Refresh Service Implementation Plan

## Overview

We will modify the `PlaylistRefreshServiceImpl` to detect changes in the playlist using the `snapshot_id` from the Spotify API. This will replace the current condition of checking for fewer than 2 upcoming tracks.

## Implementation Steps

### 1. Add a New Private Field

- Add a private field to store the last known `snapshot_id`:
  ```typescript
  private lastSnapshotId: string | null = null;
  ```

### 2. Modify `getFixedPlaylist` Method

- Update the method to return both the playlist and its `snapshot_id`:

  ```typescript
  private async getFixedPlaylist(): Promise<{ playlist: SpotifyPlaylistItem | null; snapshotId: string | null }> {
    const playlists = await this.spotifyApi.getPlaylists();
    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === this.FIXED_PLAYLEST_NAME
    );

    if (!fixedPlaylist) {
      return { playlist: null, snapshotId: null };
    }

    const playlist = await this.spotifyApi.getPlaylist(fixedPlaylist.id);
    return { playlist, snapshotId: playlist.snapshot_id };
  }
  ```

### 3. Update `refreshPlaylist` Method

- Modify the method to compare the new `snapshot_id` with the saved one:

  ```typescript
  async refreshPlaylist(
    force = false,
    params?: {
      genres: Genre[];
      yearRange: [number, number];
      popularity: number;
      allowExplicit: boolean;
      maxSongLength: number;
      songsBetweenRepeats: number;
    }
  ): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
    diagnosticInfo?: Record<string, unknown>;
    forceRefresh?: boolean;
    playerStateRefresh?: boolean;
  }> {
    if (this.isRefreshing) {
      return {
        success: false,
        message: 'Refresh operation already in progress',
        timestamp: new Date().toISOString()
      };
    }

    try {
      this.isRefreshing = true;

      const { playlist, snapshotId } = await this.withTimeout(
        this.getFixedPlaylist(),
        this.TIMEOUT_MS
      );

      if (!playlist) {
        console.error('[PlaylistRefresh] No playlist found:', {
          playlistName: this.FIXED_PLAYLIST_NAME,
          timestamp: new Date().toISOString()
        });
        return {
          success: false,
          message: `No playlist found with name: ${this.FIXED_PLAYLIST_NAME}`,
          timestamp: new Date().toISOString()
        };
      }

      // Check if the snapshot_id has changed
      const hasPlaylistChanged = this.lastSnapshotId !== snapshotId;

      // Update the lastSnapshotId
      this.lastSnapshotId = snapshotId;

      const { id: currentTrackId, error: playbackError } =
        await this.withTimeout(this.getCurrentlyPlaying(), this.TIMEOUT_MS);

      if (playbackError) {
        console.error('[PlaylistRefresh] Playback error:', {
          error: playbackError,
          timestamp: new Date().toISOString()
        });
        return {
          success: false,
          message: playbackError,
          timestamp: new Date().toISOString()
        };
      }

      const upcomingTracks = this.getUpcomingTracks(playlist, currentTrackId);

      const playbackState = await this.withTimeout(
        this.spotifyApi.getPlaybackState(),
        this.TIMEOUT_MS
      );

      const removedTrack = await this.withTimeout(
        this.autoRemoveFinishedTrack({
          playlistId: playlist.id,
          currentTrackId,
          playlistTracks: playlist.tracks.items,
          playbackState
        }),
        this.TIMEOUT_MS
      );

      // Resume playback if the playlist has changed
      if (hasPlaylistChanged && playbackState?.context?.uri && playbackState?.item?.uri) {
        try {
          await this.withTimeout(
            sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: playbackState.context.uri,
                offset: { uri: playbackState.item.uri },
                position_ms: playbackState.progress_ms ?? 0
              },
              retryConfig: this.retryConfig
            }),
            this.TIMEOUT_MS
          );
        } catch (error) {
          console.error('[PlaylistRefresh] Failed to resume playback:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      }

      const diagnosticInfo = {
        currentTrackId,
        totalTracks: playlist.tracks.items.length,
        upcomingTracksCount: upcomingTracks.length,
        playlistTrackIds: playlist.tracks.items.map((t) => t.track.id),
        upcomingTrackIds: upcomingTracks.map((t) => t.track.id),
        removedTrack,
        addedTrack: false
      };

      const result = await this.withTimeout(
        this.addSuggestedTrackToPlaylist(
          upcomingTracks,
          playlist.id,
          currentTrackId,
          playlist.tracks.items,
          params
        ),
        this.TIMEOUT_MS
      );

      if (!result.success) {
        console.error('[PlaylistRefresh] Failed to add track:', {
          error: result.error,
          diagnosticInfo,
          timestamp: new Date().toISOString()
        });
        return {
          success: false,
          message:
            result.error === 'Playlist too long'
              ? `Playlist has reached maximum length of ${MAX_PLAYLIST_LENGTH} tracks. No new tracks needed.`
              : result.error || 'Failed to add track',
          timestamp: new Date().toISOString(),
          diagnosticInfo,
          forceRefresh: force
        };
      }

      diagnosticInfo.addedTrack = true;

      return {
        success: true,
        message: 'Track added successfully',
        timestamp: new Date().toISOString(),
        diagnosticInfo,
        forceRefresh: force,
        playerStateRefresh: true
      };
    } catch (error) {
      console.error('[PlaylistRefresh] Error in refreshPlaylist:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to refresh playlist',
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isRefreshing = false;
    }
  }
  ```

### 4. Update `refreshTrackSuggestions` Method

- Ensure the `refreshTrackSuggestions` method also uses the updated `getFixedPlaylist` method to maintain consistency.

### 5. Testing

- Test the changes to ensure that the `snapshot_id` comparison works correctly and that the play endpoint is called only when the playlist has changed.

## Technical Considerations

### Performance

- The `snapshot_id` comparison is a lightweight operation
- No additional API calls are required as we're already fetching the playlist data
- The change detection is more accurate than the previous track count check

### Error Handling

- Maintain existing error handling for API calls
- Add specific error handling for `snapshot_id` comparison
- Ensure proper logging of playlist changes

### State Management

- The `lastSnapshotId` field maintains state between refresh operations
- State is persisted within the singleton instance
- No additional storage requirements

## Migration Strategy

1. **Phase 1: Implementation**

   - Add `lastSnapshotId` field
   - Update `getFixedPlaylist` method
   - Modify `refreshPlaylist` method
   - Update `refreshTrackSuggestions` method

2. **Phase 2: Testing**

   - Unit tests for new functionality
   - Integration tests for playlist change detection
   - End-to-end tests for playback resume
   - Performance testing

3. **Phase 3: Deployment**
   - Gradual rollout
   - Monitor for any issues
   - Gather metrics on playlist change detection accuracy
   - Verify playback resume functionality

## Success Metrics

- Accurate detection of playlist changes
- Proper playback resume after changes
- No unnecessary playback interruptions
- Improved user experience during playlist updates

## Timeline

1. Implementation: 2 days
2. Testing: 1 day
3. Deployment: 1 day

Total estimated time: 4 days

## Monitoring and Analytics

- Track API call frequency
- Monitor cache hit rates
- Measure prediction accuracy
- Track user experience
- Monitor error rates
