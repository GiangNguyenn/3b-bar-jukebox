import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { renderHook, act } from '@testing-library/react-hooks';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { sendApiRequest } from '@/shared/api';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { TrackItem, SpotifyPlaylistItem, SpotifyPlaylists } from '@/shared/types';
import * as useCreateNewDailyPlaylistModule from '../useCreateNewDailyPlayList';
import * as useGetPlaylistModule from '../useGetPlaylist';

const mockRefetch = jest.fn().mockImplementation(() => Promise.resolve());

const mockPlaylist: SpotifyPlaylistItem = {
  collaborative: false,
  description: 'Test Description',
  external_urls: { spotify: 'https://spotify.com/playlist/test' },
  href: 'https://api.spotify.com/v1/playlists/test',
  id: 'test-playlist-id',
  images: [],
  name: 'Test Playlist',
  owner: {
    external_urls: { spotify: 'https://spotify.com/user/test' },
    followers: { href: null, total: 0 },
    href: 'https://api.spotify.com/v1/users/test',
    id: 'test-user',
    type: 'user',
    uri: 'spotify:user:test',
    display_name: 'Test User'
  },
  public: false,
  snapshot_id: 'test-snapshot',
  tracks: {
    href: 'https://api.spotify.com/v1/playlists/test/tracks',
    total: 0,
    limit: 100,
    offset: 0,
    items: []
  },
  type: 'playlist',
  uri: 'spotify:playlist:test'
};

const mockPlaylists: SpotifyPlaylists = {
  href: 'https://api.spotify.com/v1/me/playlists',
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 1,
  items: [mockPlaylist]
};

jest.mock('@/shared/api', () => ({
  sendApiRequest: jest.fn()
}));

const mockSendApiRequest = jest.mocked(sendApiRequest);

const mockTrack: TrackItem = {
  track: {
    uri: 'spotify:track:test',
    name: 'Test Track',
    artists: [{
      name: 'Test Artist',
      external_urls: { spotify: 'https://open.spotify.com/artist/test' },
      href: 'https://api.spotify.com/v1/artists/test',
      id: 'test',
      type: 'artist',
      uri: 'spotify:artist:test'
    }],
    album: {
      name: 'Test Album',
      album_type: 'album',
      total_tracks: 1,
      available_markets: ['US'],
      external_urls: { spotify: 'https://open.spotify.com/album/test' },
      href: 'https://api.spotify.com/v1/albums/test',
      id: 'test',
      type: 'album',
      uri: 'spotify:album:test',
      images: [],
      release_date: '',
      release_date_precision: 'day',
      artists: []
    },
    available_markets: ['US'],
    disc_number: 1,
    duration_ms: 180000,
    explicit: false,
    external_ids: { isrc: 'MOCK123456789' },
    external_urls: { spotify: 'https://open.spotify.com/track/test' },
    href: 'https://api.spotify.com/v1/tracks/test',
    id: 'test',
    is_playable: true,
    is_local: false,
    popularity: 50,
    preview_url: 'https://p.scdn.co/mp3-preview/test',
    track_number: 1,
    type: 'track'
  },
  added_at: new Date().toISOString(),
  added_by: {
    external_urls: { spotify: 'https://open.spotify.com/user/test' },
    href: 'https://api.spotify.com/v1/users/test',
    id: 'test',
    type: 'user',
    uri: 'spotify:user:test'
  },
  is_local: false
};

describe('useRemoveTrackFromPlaylist', () => {
  beforeEach(() => {
    mockSendApiRequest.mockClear();
    jest.resetModules();
  });

  it('should remove track from playlist successfully', async () => {
    // Mock hooks for successful case
    jest.spyOn(useCreateNewDailyPlaylistModule, 'useCreateNewDailyPlaylist').mockReturnValue({
      todayPlaylistId: 'test-playlist-id',
      error: null
    } as any);
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: false,
      refetchPlaylist: mockRefetch
    } as any);

    mockSendApiRequest.mockResolvedValueOnce({});
    
    const { result } = renderHook(() => useRemoveTrackFromPlaylist());
    
    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(mockSendApiRequest).toHaveBeenCalledWith({
      path: 'playlists/test-playlist-id/tracks',
      method: 'DELETE',
      body: { tracks: [{ uri: mockTrack.track.uri }] }
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle API error', async () => {
    // Mock hooks for API error case
    jest.spyOn(useCreateNewDailyPlaylistModule, 'useCreateNewDailyPlaylist').mockReturnValue({
      todayPlaylistId: 'test-playlist-id',
      error: null
    } as any);
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: false,
      refetchPlaylist: mockRefetch
    } as any);

    mockSendApiRequest.mockRejectedValueOnce(new Error('API Error'));
    
    const { result } = renderHook(() => useRemoveTrackFromPlaylist());
    
    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.FAILED_TO_REMOVE);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle no playlist available error', async () => {
    // Mock hooks for no playlist case
    jest.spyOn(useCreateNewDailyPlaylistModule, 'useCreateNewDailyPlaylist').mockReturnValue({
      todayPlaylistId: null,
      error: null
    } as any);
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: false,
      refetchPlaylist: mockRefetch
    } as any);

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());
    
    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(result.current.error).toBe(ERROR_MESSAGES.NO_PLAYLIST);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle playlist error', async () => {
    // Mock hooks for playlist error case
    jest.spyOn(useCreateNewDailyPlaylistModule, 'useCreateNewDailyPlaylist').mockReturnValue({
      todayPlaylistId: 'test-playlist-id',
      error: 'Failed to load playlist'
    } as any);
    jest.spyOn(useGetPlaylistModule, 'useGetPlaylist').mockReturnValue({
      isError: true,
      refetchPlaylist: mockRefetch
    } as any);

    const { result } = renderHook(() => useRemoveTrackFromPlaylist());
    
    await act(async () => {
      await result.current.removeTrack(mockTrack);
    });

    expect(result.current.error).toBe('Failed to load playlist');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
}); 