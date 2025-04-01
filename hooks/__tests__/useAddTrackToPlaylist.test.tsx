import { renderHook, act } from '@testing-library/react';
import { sendApiRequest } from '@/shared/api';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { ReactNode } from 'react';
import { TrackItem } from '@/shared/types';

// Mock dependencies
jest.mock('@/shared/api', () => ({
  sendApiRequest: jest.fn()
}));

jest.mock('../useCreateNewDailyPlayList', () => ({
  useCreateNewDailyPlaylist: jest.fn(() => ({
    todayPlaylistId: 'mock-playlist-id',
    error: null,
    isError: false
  }))
}));

// Create a mock track item that matches the interface
const createMockTrackItem = (uri: string): TrackItem => ({
  added_at: new Date().toISOString(),
  added_by: {
    external_urls: { spotify: 'https://open.spotify.com/user/mock' },
    href: 'https://api.spotify.com/v1/users/mock',
    id: 'mock-user',
    type: 'user',
    uri: 'spotify:user:mock'
  },
  is_local: false,
  track: {
    album: {
      album_type: 'album',
      total_tracks: 1,
      available_markets: ['US'],
      external_urls: { spotify: 'https://open.spotify.com/album/mock' },
      href: 'https://api.spotify.com/v1/albums/mock',
      id: 'mock-album',
      images: [{ url: 'mock-url', height: 300, width: 300 }],
      name: 'Mock Album',
      release_date: '2024-01-01',
      release_date_precision: 'day',
      type: 'album',
      uri: 'spotify:album:mock',
      artists: [{
        external_urls: { spotify: 'https://open.spotify.com/artist/mock' },
        href: 'https://api.spotify.com/v1/artists/mock',
        id: 'mock-artist',
        name: 'Mock Artist',
        type: 'artist',
        uri: 'spotify:artist:mock'
      }]
    },
    artists: [{
      external_urls: { spotify: 'https://open.spotify.com/artist/mock' },
      href: 'https://api.spotify.com/v1/artists/mock',
      id: 'mock-artist',
      name: 'Mock Artist',
      type: 'artist',
      uri: 'spotify:artist:mock'
    }],
    available_markets: ['US'],
    disc_number: 1,
    duration_ms: 180000,
    explicit: false,
    external_ids: { isrc: 'MOCK123456789' },
    external_urls: { spotify: 'https://open.spotify.com/track/mock' },
    href: 'https://api.spotify.com/v1/tracks/mock',
    id: 'mock-track',
    is_playable: true,
    name: 'Mock Track',
    popularity: 50,
    preview_url: 'https://p.scdn.co/mp3-preview/mock',
    track_number: 1,
    type: 'track',
    uri: uri,
    is_local: false
  }
});

jest.mock('../useGetPlaylist', () => ({
  useGetPlaylist: jest.fn(() => ({
    data: {
      tracks: {
        items: []
      }
    },
    refetchPlaylist: jest.fn()
  }))
}));

// Mock React hooks
const mockSetState = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: jest.fn((initial) => [initial, mockSetState])
}));

// Mock SWR
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    data: null,
    error: null,
    mutate: jest.fn(),
    isLoading: false
  })),
  SWRConfig: ({ children }: { children: ReactNode }) => children
}));

// Import the hook after all mocks are set up
import { useAddTrackToPlaylist } from '../useAddTrackToPlaylist';

describe('useAddTrackToPlaylist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset useState mock to return initial values
    (jest.requireMock('react').useState as jest.Mock).mockImplementation((initial) => [initial, mockSetState]);
    // Reset useGetPlaylist mock to return empty playlist
    jest.requireMock('../useGetPlaylist').useGetPlaylist.mockReturnValue({
      data: {
        tracks: {
          items: []
        }
      },
      refetchPlaylist: jest.fn()
    });
    // Reset useCreateNewDailyPlaylist mock to return valid playlist ID
    jest.requireMock('../useCreateNewDailyPlayList').useCreateNewDailyPlaylist.mockReturnValue({
      todayPlaylistId: 'mock-playlist-id',
      error: null,
      isError: false
    });
  });

  it('should successfully add a new track to playlist', async () => {
    const { result } = renderHook(() => useAddTrackToPlaylist());

    await act(async () => {
      await result.current.addTrack('spotify:track:new-track');
    });

    expect(sendApiRequest).toHaveBeenCalledWith({
      path: 'playlists/mock-playlist-id/tracks',
      method: 'POST',
      body: {
        uris: ['spotify:track:new-track']
      }
    });

    // Verify state changes
    expect(mockSetState).toHaveBeenCalledWith(true); // isLoading true
    expect(mockSetState).toHaveBeenCalledWith(null); // error null
    expect(mockSetState).toHaveBeenCalledWith(false); // isSuccess false initially
    expect(mockSetState).toHaveBeenCalledWith(true); // isSuccess true after success
    expect(mockSetState).toHaveBeenCalledWith(false); // isLoading false
  });

  it('should prevent adding a track that already exists', async () => {
    // Mock playlist with existing track
    jest.requireMock('../useGetPlaylist').useGetPlaylist.mockReturnValue({
      data: {
        tracks: {
          items: [createMockTrackItem('spotify:track:existing-track')]
        }
      },
      refetchPlaylist: jest.fn()
    });

    const { result } = renderHook(() => useAddTrackToPlaylist());

    await act(async () => {
      await result.current.addTrack('spotify:track:existing-track');
    });

    expect(sendApiRequest).not.toHaveBeenCalled();
    
    // Verify state changes in order
    const calls = mockSetState.mock.calls.map(call => call[0]);
    expect(calls).toContain(true); // isLoading true
    expect(calls).toContain(null); // error null initially
    expect(calls).toContain(ERROR_MESSAGES.TRACK_EXISTS); // error set
    expect(calls).toContain(false); // isLoading false
  });

  it('should handle API errors', async () => {
    (sendApiRequest as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

    const { result } = renderHook(() => useAddTrackToPlaylist());

    await act(async () => {
      await result.current.addTrack('spotify:track:new-track');
    });

    // Verify state changes in order
    const calls = mockSetState.mock.calls.map(call => call[0]);
    expect(calls).toContain(true); // isLoading true
    expect(calls).toContain(null); // error null initially
    expect(calls).toContain(ERROR_MESSAGES.FAILED_TO_ADD); // error set
    expect(calls).toContain(false); // isLoading false
  });

  it('should handle missing playlist', async () => {
    // Mock missing playlist
    jest.requireMock('../useGetPlaylist').useGetPlaylist.mockReturnValue({
      data: null,
      refetchPlaylist: jest.fn()
    });

    const { result } = renderHook(() => useAddTrackToPlaylist());

    await act(async () => {
      await result.current.addTrack('spotify:track:new-track');
    });

    expect(sendApiRequest).not.toHaveBeenCalled();
    
    // Verify state changes in order
    const calls = mockSetState.mock.calls.map(call => call[0]);
    expect(calls).toContain(true); // isLoading true
    expect(calls).toContain(null); // error null initially
    expect(calls).toContain(ERROR_MESSAGES.NO_PLAYLIST); // error set
    expect(calls).toContain(false); // isLoading false
  });

  it('should handle playlist error state', async () => {
    // Mock playlist error
    jest.requireMock('../useCreateNewDailyPlaylist').useCreateNewDailyPlaylist.mockReturnValue({
      todayPlaylistId: null,
      error: ERROR_MESSAGES.FAILED_TO_LOAD,
      isError: true
    });

    const { result } = renderHook(() => useAddTrackToPlaylist());

    await act(async () => {
      await result.current.addTrack('spotify:track:new-track');
    });

    expect(sendApiRequest).not.toHaveBeenCalled();
    
    // Verify state changes in order
    const calls = mockSetState.mock.calls.map(call => call[0]);
    expect(calls).toContain(true); // isLoading true
    expect(calls).toContain(null); // error null initially
    expect(calls).toContain(ERROR_MESSAGES.FAILED_TO_LOAD); // error set
    expect(calls).toContain(false); // isLoading false
  });

  it('should refetch playlist after successfully adding a track', async () => {
    const mockRefetchPlaylist = jest.fn();
    jest.requireMock('../useGetPlaylist').useGetPlaylist.mockReturnValue({
      data: {
        tracks: {
          items: []
        }
      },
      refetchPlaylist: mockRefetchPlaylist
    });

    const { result } = renderHook(() => useAddTrackToPlaylist());

    await act(async () => {
      await result.current.addTrack('spotify:track:new-track');
    });

    expect(sendApiRequest).toHaveBeenCalledWith({
      path: 'playlists/mock-playlist-id/tracks',
      method: 'POST',
      body: {
        uris: ['spotify:track:new-track']
      }
    });

    expect(mockRefetchPlaylist).toHaveBeenCalled();
  });
}); 