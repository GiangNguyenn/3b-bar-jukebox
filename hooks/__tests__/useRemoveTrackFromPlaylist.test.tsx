import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { sendApiRequest } from '@/shared/api';
import { useCreateNewDailyPlaylist } from '../useCreateNewDailyPlayList';
import { useGetPlaylist } from '../useGetPlaylist';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { TrackItem } from '@/shared/types';

// Mock the API request function
jest.mock('@/shared/api', () => ({
  sendApiRequest: jest.fn(),
}));

// Mock the dependent hooks
jest.mock('../useCreateNewDailyPlayList', () => ({
  useCreateNewDailyPlaylist: jest.fn(),
}));

jest.mock('../useGetPlaylist', () => ({
  useGetPlaylist: jest.fn(),
}));

const mockPlaylistId = 'test-playlist-id';
const mockTrack: TrackItem = {
  added_at: '2024-01-01T00:00:00Z',
  added_by: {
    external_urls: {
      spotify: 'https://open.spotify.com/user/test',
    },
    href: 'https://api.spotify.com/v1/users/test',
    id: 'test',
    type: 'user',
    uri: 'spotify:user:test',
  },
  is_local: false,
  track: {
    album: {
      album_type: 'album',
      artists: [
        {
          external_urls: {
            spotify: 'https://open.spotify.com/artist/test',
          },
          href: 'https://api.spotify.com/v1/artists/test',
          id: 'test',
          name: 'Test Artist',
          type: 'artist',
          uri: 'spotify:artist:test',
        },
      ],
      available_markets: ['US'],
      external_urls: {
        spotify: 'https://open.spotify.com/album/test',
      },
      href: 'https://api.spotify.com/v1/albums/test',
      id: 'test',
      images: [
        {
          height: 640,
          url: 'https://i.scdn.co/image/test',
          width: 640,
        },
      ],
      name: 'Test Album',
      release_date: '2024-01-01',
      release_date_precision: 'day',
      total_tracks: 10,
      type: 'album',
      uri: 'spotify:album:test',
    },
    artists: [
      {
        external_urls: {
          spotify: 'https://open.spotify.com/artist/test',
        },
        href: 'https://api.spotify.com/v1/artists/test',
        id: 'test',
        name: 'Test Artist',
        type: 'artist',
        uri: 'spotify:artist:test',
      },
    ],
    available_markets: ['US'],
    disc_number: 1,
    duration_ms: 180000,
    explicit: false,
    external_ids: {
      isrc: 'USRC12345678',
    },
    external_urls: {
      spotify: 'https://open.spotify.com/track/test',
    },
    href: 'https://api.spotify.com/v1/tracks/test',
    id: 'test',
    is_local: false,
    name: 'Test Track',
    popularity: 50,
    preview_url: 'https://p.scdn.co/mp3-preview/test',
    track_number: 1,
    type: 'track',
    uri: 'spotify:track:test',
    is_playable: true
  }
};

const mockPlaylist = {
  id: mockPlaylistId,
  tracks: {
    items: [mockTrack],
  },
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <React.StrictMode>{children}</React.StrictMode>
);

describe('useRemoveTrackFromPlaylist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up default mock implementations
    (useCreateNewDailyPlaylist as jest.Mock).mockReturnValue({
      todayPlaylistId: mockPlaylistId,
      error: null,
      isError: false,
    });
    (useGetPlaylist as jest.Mock).mockReturnValue({
      data: mockPlaylist,
      refetchPlaylist: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('should successfully remove a track from the playlist', async () => {
    (sendApiRequest as jest.Mock).mockResolvedValueOnce({});
    const { result } = renderHook(() => useRemoveTrackFromPlaylist(), { wrapper });

    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(sendApiRequest).toHaveBeenCalledWith({
      path: `playlists/${mockPlaylistId}/tracks`,
      method: 'DELETE',
      body: {
        tracks: [{
          uri: mockTrack.track.uri
        }]
      },
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle API errors when removing a track', async () => {
    (sendApiRequest as jest.Mock).mockRejectedValueOnce(new Error('API Error'));
    const { result } = renderHook(() => useRemoveTrackFromPlaylist(), { wrapper });

    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.FAILED_TO_REMOVE);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle missing playlist ID', async () => {
    (useCreateNewDailyPlaylist as jest.Mock).mockReturnValue({
      todayPlaylistId: null,
      error: null,
      isError: false,
    });
    const { result } = renderHook(() => useRemoveTrackFromPlaylist(), { wrapper });

    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.NO_PLAYLIST);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle playlist error', async () => {
    (useCreateNewDailyPlaylist as jest.Mock).mockReturnValue({
      todayPlaylistId: mockPlaylistId,
      error: ERROR_MESSAGES.FAILED_TO_LOAD,
      isError: true,
    });
    const { result } = renderHook(() => useRemoveTrackFromPlaylist(), { wrapper });

    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.FAILED_TO_LOAD);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle loading state correctly', async () => {
    (sendApiRequest as jest.Mock).mockResolvedValueOnce({});

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());

    // Start the track removal
    await act(async () => {
      result.current.removeTrack(mockTrack);
    });

    // Wait for state updates to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    // Check success state is true and loading is false
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
}); 