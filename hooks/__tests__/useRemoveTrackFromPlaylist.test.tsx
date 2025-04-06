import { renderHook, act } from '@testing-library/react-hooks';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { useGetPlaylist } from '../useGetPlaylist';
import { useFixedPlaylist } from '../useFixedPlaylist';
import { sendApiRequest } from '@/shared/api';
import { TrackItem } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { AppError } from '@/shared/utils/errorHandling';

jest.mock('../useGetPlaylist');
jest.mock('../useFixedPlaylist');
jest.mock('@/shared/api');

const mockSendApiRequest = sendApiRequest as jest.Mock;

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
    (useFixedPlaylist as jest.Mock).mockReturnValue({
      fixedPlaylistId: mockPlaylistId,
      error: null
    });
    (useGetPlaylist as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetchPlaylist: jest.fn()
    });
    mockSendApiRequest.mockResolvedValue({});
  });

  it('should remove track from playlist successfully', async () => {
    const mockRefetchPlaylist = jest.fn();
    (useGetPlaylist as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetchPlaylist: mockRefetchPlaylist
    });

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());

    expect(result.current.removeTrack).toBeDefined();
    expect(result.current.removeTrack).not.toBeNull();

    await act(async () => {
      await result.current.removeTrack!(mockTrack);
    });

    expect(mockSendApiRequest).toHaveBeenCalledWith({
      path: `playlists/${mockPlaylistId}/tracks`,
      method: 'DELETE',
      body: { tracks: [{ uri: mockTrack.track.uri }] }
    });
    expect(mockRefetchPlaylist).toHaveBeenCalled();
  });

  it('should handle errors when removing track', async () => {
    const mockRefetchPlaylist = jest.fn();
    (useGetPlaylist as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetchPlaylist: mockRefetchPlaylist
    });
    mockSendApiRequest.mockRejectedValue(new Error('Failed to remove track'));

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());

    expect(result.current.removeTrack).toBeDefined();
    expect(result.current.removeTrack).not.toBeNull();

    await act(async () => {
      await expect(result.current.removeTrack!(mockTrack)).rejects.toThrow('Failed to remove track');
    });
  });

  it('should handle missing playlist ID', async () => {
    (useFixedPlaylist as jest.Mock).mockReturnValue({
      fixedPlaylistId: null,
      error: null
    });

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());

    expect(result.current.removeTrack).toBeNull();
    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.error?.message).toBe(ERROR_MESSAGES.NO_PLAYLIST);
  });
}); 