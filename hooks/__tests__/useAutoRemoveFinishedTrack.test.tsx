import { renderHook, act } from '@testing-library/react-hooks';
import { useAutoRemoveFinishedTrack } from '../useAutoRemoveFinishedTrack';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { TrackItem, SpotifyPlaybackState } from '@/shared/types';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

// Mock the useRemoveTrackFromPlaylist hook
const mockRemoveTrack = jest.fn().mockImplementation(() => Promise.resolve());

// Use a different approach for mocking
jest.mock('../useRemoveTrackFromPlaylist', () => {
  return {
    useRemoveTrackFromPlaylist: () => ({
      removeTrack: mockRemoveTrack,
      isLoading: false,
      isSuccess: false,
      error: null
    })
  };
});

// Mock timers
jest.useFakeTimers();

const createMockTrack = (id: string): TrackItem => ({
  added_at: '2024-01-01T00:00:00Z',
  added_by: {
    external_urls: { spotify: 'https://open.spotify.com/user/test' },
    href: 'https://api.spotify.com/v1/users/test',
    id: 'test',
    type: 'user',
    uri: 'spotify:user:test'
  },
  is_local: false,
  track: {
    album: {
      album_type: 'album',
      total_tracks: 1,
      available_markets: ['US'],
      external_urls: { spotify: 'https://open.spotify.com/album/test' },
      href: 'https://api.spotify.com/v1/albums/test',
      id: 'test',
      images: [{ url: 'test-url', height: 300, width: 300 }],
      name: 'Test Album',
      release_date: '2024-01-01',
      release_date_precision: 'day',
      type: 'album',
      uri: 'spotify:album:test',
      artists: [{
        external_urls: { spotify: 'https://open.spotify.com/artist/test' },
        href: 'https://api.spotify.com/v1/artists/test',
        id: 'test',
        name: 'Test Artist',
        type: 'artist',
        uri: 'spotify:artist:test'
      }]
    },
    artists: [{
      external_urls: { spotify: 'https://open.spotify.com/artist/test' },
      href: 'https://api.spotify.com/v1/artists/test',
      id: 'test',
      name: 'Test Artist',
      type: 'artist',
      uri: 'spotify:artist:test'
    }],
    available_markets: ['US'],
    disc_number: 1,
    duration_ms: 180000,
    explicit: false,
    external_ids: { 
      isrc: 'MOCK123456789'
    },
    external_urls: { spotify: 'https://open.spotify.com/track/test' },
    href: 'https://api.spotify.com/v1/tracks/test',
    id,
    is_playable: true,
    name: `Track ${id}`,
    popularity: 50,
    preview_url: 'https://p.scdn.co/mp3-preview/test',
    track_number: 1,
    type: 'track',
    uri: `spotify:track:${id}`,
    is_local: false
  }
});

const createMockPlaybackState = (id: string): SpotifyPlaybackState => {
  const track = createMockTrack(id).track;
  const { preview_url, ...trackWithoutPreview } = track;
  return {
    device: {
      id: 'test-device',
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: 'Test Device',
      type: 'Computer',
      volume_percent: 50,
      supports_volume: true
    },
    repeat_state: 'off',
    shuffle_state: false,
    timestamp: Date.now(),
    progress_ms: 0,
    is_playing: true,
    item: {
      ...trackWithoutPreview,
      linked_from: {},
      external_ids: {
        isrc: 'MOCK123456789',
        ean: '1234567890123',
        upc: '123456789012'
      },
      preview_url: 'https://p.scdn.co/mp3-preview/test'
    },
    currently_playing_type: 'track',
    actions: {
      interrupting_playback: false,
      pausing: false,
      resuming: false,
      seeking: false,
      skipping_next: false,
      skipping_prev: false,
      toggling_repeat_context: false,
      toggling_shuffle: false,
      toggling_repeat_track: false,
      transferring_playback: false
    },
    context: {
      type: 'playlist',
      href: 'https://api.spotify.com/v1/playlists/test',
      external_urls: { spotify: 'https://open.spotify.com/playlist/test' },
      uri: 'spotify:playlist:test'
    }
  };
};

describe('useAutoRemoveFinishedTrack', () => {
  beforeEach(() => {
    mockRemoveTrack.mockClear();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('should remove oldest track when current track index is >= 5', async () => {
    const tracks = Array.from({ length: 10 }, (_, i) => createMockTrack(`track-${i}`));
    const playbackState = createMockPlaybackState('track-5');
    
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'track-5',
      playlistTracks: tracks,
      playbackState
    }));

    // Fast-forward time by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockRemoveTrack).toHaveBeenCalledWith(tracks[0]);
  });

  it('should not remove any track when current track index is < 5', async () => {
    const tracks = Array.from({ length: 10 }, (_, i) => createMockTrack(`track-${i}`));
    const playbackState = createMockPlaybackState('track-3');
    
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'track-3',
      playlistTracks: tracks,
      playbackState
    }));

    // Fast-forward time by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockRemoveTrack).not.toHaveBeenCalled();
  });

  it('should not remove any track when playlist is empty', async () => {
    const playbackState = createMockPlaybackState('track-5');
    
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'track-5',
      playlistTracks: [],
      playbackState
    }));

    // Fast-forward time by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockRemoveTrack).not.toHaveBeenCalled();
  });
}); 