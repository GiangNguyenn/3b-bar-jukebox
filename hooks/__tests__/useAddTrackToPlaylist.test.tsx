import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { renderHook, act } from '@testing-library/react-hooks';
import { useAddTrackToPlaylist } from '../useAddTrackToPlaylist';
import { sendApiRequest } from '@/shared/api';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { TrackItem } from '@/shared/types';
import * as useGetPlaylistModule from '../useGetPlaylist';

type MockRefetchFunction = () => Promise<void>;
const mockRefetch = jest.fn().mockImplementation(() => Promise.resolve()) as jest.Mock<MockRefetchFunction>;

jest.mock('@/shared/api', () => ({
  sendApiRequest: jest.fn()
}));

const mockSendApiRequest = jest.mocked(sendApiRequest);

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
    album: {
      album_type: 'album',
      total_tracks: 1,
      available_markets: ['US'],
      external_urls: { spotify: 'https://spotify.com/album/test' },
      href: 'https://api.spotify.com/v1/albums/test',
      id: 'test-album',
      images: [],
      name: 'Test Album',
      release_date: '2024-01-01',
      release_date_precision: 'day',
      type: 'album',
      uri: 'spotify:album:test',
      artists: []
    },
    artists: [],
    available_markets: ['US'],
    disc_number: 1,
    duration_ms: 1000,
    explicit: false,
    external_ids: { isrc: 'test' },
    external_urls: { spotify: 'https://spotify.com/track/test' },
    href: 'https://api.spotify.com/v1/tracks/test',
    id: 'test-track',
    is_playable: true,
    name: 'Test Track',
    popularity: 0,
    preview_url: null,
    track_number: 1,
    type: 'track',
    uri: 'spotify:track:test',
    is_local: false
  }
};

describe('useAddTrackToPlaylist', () => {
  beforeEach(() => {
    mockSendApiRequest.mockClear();
    jest.resetModules();
  });

  it('should add track to playlist successfully', async () => {
    // Mock hooks for successful case
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: false,
      refetchPlaylist: mockRefetch
    } as any);

    mockSendApiRequest.mockResolvedValueOnce({});
    
    const { result } = renderHook(() => useAddTrackToPlaylist({ playlistId: 'test-playlist-id' }));
    
    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(mockSendApiRequest).toHaveBeenCalledWith({
      path: '/api/playlist/add-track',
      method: 'POST',
      body: { playlistId: 'test-playlist-id', track: mockTrack }
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle API error', async () => {
    // Mock hooks for API error case
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: false,
      refetchPlaylist: mockRefetch
    } as any);

    mockSendApiRequest.mockRejectedValueOnce(new Error('API Error'));
    
    const { result } = renderHook(() => useAddTrackToPlaylist({ playlistId: 'test-playlist-id' }));
    
    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.FAILED_TO_ADD);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle no playlist available error', async () => {
    // Mock hooks for no playlist case
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: false,
      refetchPlaylist: mockRefetch
    } as any);

    const { result } = renderHook(() => useAddTrackToPlaylist({ playlistId: '' }));
    
    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.NO_PLAYLIST);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle playlist error', async () => {
    // Mock hooks for playlist error case
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: true,
      refetchPlaylist: mockRefetch
    } as any);

    const { result } = renderHook(() => useAddTrackToPlaylist({ playlistId: 'test-playlist-id' }));
    
    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(result.current.error).toBe('Failed to load playlist');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});