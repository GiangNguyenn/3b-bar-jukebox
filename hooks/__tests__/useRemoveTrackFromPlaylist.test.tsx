import { renderHook, act } from '@testing-library/react';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { usePlaylist } from '../usePlaylist';
import { TrackItem } from '@/shared/types';

jest.mock('../usePlaylist');

describe('useRemoveTrackFromPlaylist', () => {
  const mockPlaylistId = 'test-playlist-id';
  const mockTrack: TrackItem = {
    added_at: '2024-01-01T00:00:00Z',
    added_by: {
      external_urls: { spotify: 'https://spotify.com/user/test' },
      href: 'https://api.spotify.com/v1/users/test',
      id: 'test-user',
      type: 'user',
      uri: 'spotify:user:test'
    },
    is_local: false,
    track: {
      uri: 'spotify:track:test',
      name: 'Test Track',
      artists: [{
        name: 'Test Artist',
        external_urls: { spotify: 'https://spotify.com/artist/test' },
        href: 'https://api.spotify.com/v1/artists/test',
        id: 'test-artist',
        type: 'artist',
        uri: 'spotify:artist:test'
      }],
      album: {
        name: 'Test Album',
        images: [{
          url: 'test.jpg',
          height: 640,
          width: 640
        }],
        album_type: 'album',
        total_tracks: 1,
        available_markets: ['US'],
        external_urls: { spotify: 'https://spotify.com/album/test' },
        href: 'https://api.spotify.com/v1/albums/test',
        id: 'test-album',
        release_date: '2024-01-01',
        release_date_precision: 'day',
        type: 'album',
        uri: 'spotify:album:test',
        artists: [{
          name: 'Test Artist',
          external_urls: { spotify: 'https://spotify.com/artist/test' },
          href: 'https://api.spotify.com/v1/artists/test',
          id: 'test-artist',
          type: 'artist',
          uri: 'spotify:artist:test'
        }]
      },
      duration_ms: 180000,
      explicit: false,
      external_urls: { spotify: 'https://spotify.com/track/test' },
      href: 'https://api.spotify.com/v1/tracks/test',
      id: 'test-track',
      is_local: false,
      popularity: 50,
      preview_url: 'https://preview.spotify.com/test',
      track_number: 1,
      type: 'track',
      available_markets: ['US'],
      disc_number: 1,
      external_ids: {},
      is_playable: true
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should remove track from playlist successfully', async () => {
    const mockRefreshPlaylist = jest.fn();
    (usePlaylist as jest.Mock).mockReturnValue({
      refreshPlaylist: mockRefreshPlaylist
    });

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());

    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(mockRefreshPlaylist).toHaveBeenCalled();
  });

  it('should handle errors when removing track', async () => {
    const mockRefreshPlaylist = jest.fn().mockRejectedValue(new Error('Failed to remove track'));
    (usePlaylist as jest.Mock).mockReturnValue({
      refreshPlaylist: mockRefreshPlaylist
    });

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());

    await act(async () => {
      await expect(result.current.removeTrack(mockTrack)).rejects.toThrow('Failed to remove track');
    });
  });
}); 