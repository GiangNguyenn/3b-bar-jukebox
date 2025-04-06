import { PlaylistRefreshServiceImpl } from './playlistRefresh';
import { SpotifyApiClient } from './spotifyApi';
import { SpotifyPlaylistItem, TrackItem } from '@/shared/types';

describe('PlaylistRefreshService', () => {
  it('should successfully refresh playlist', async () => {
    // Mock Spotify API client
    const mockSpotifyApi: SpotifyApiClient = {
      getPlaylists: jest.fn().mockResolvedValue({
        items: [{
          id: 'playlist1',
          name: '3B Saigon',
          tracks: { items: [] }
        }]
      }),
      getPlaylist: jest.fn().mockResolvedValue({
        id: 'playlist1',
        name: '3B Saigon',
        tracks: { items: [] }
      }),
      getCurrentlyPlaying: jest.fn().mockResolvedValue({
        item: { id: 'track1' }
      }),
      addTrackToPlaylist: jest.fn().mockResolvedValue(undefined),
      getPlaybackState: jest.fn().mockResolvedValue({
        is_playing: true
      })
    };

    // Create service instance with mock
    const service = new PlaylistRefreshServiceImpl(mockSpotifyApi);

    // Call refresh playlist
    const result = await service.refreshPlaylist();

    // Verify result
    expect(result.success).toBe(true);
    expect(result.message).toBe('Track added successfully');
  });
}); 