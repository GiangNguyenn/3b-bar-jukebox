import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { waitFor } from '@testing-library/dom';
import { useAutoRemoveFinishedTrack } from '../useAutoRemoveFinishedTrack';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { TrackItem, SpotifyPlaybackState } from '@/shared/types';
import { filterUpcomingTracks } from '@/lib/utils';

// Mock the useRemoveTrackFromPlaylist hook
jest.mock('../useRemoveTrackFromPlaylist', () => ({
  useRemoveTrackFromPlaylist: jest.fn(),
}));

// Mock the filterUpcomingTracks utility
jest.mock('@/lib/utils', () => ({
  filterUpcomingTracks: jest.fn(),
}));

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
    duration_ms: 180000, // 3 minutes
    explicit: false,
    external_ids: {
      isrc: 'USRC12345678',
      ean: '1234567890123',
      upc: '1234567890123'
    },
    external_urls: {
      spotify: 'https://open.spotify.com/track/test'
    },
    href: 'https://api.spotify.com/v1/tracks/test',
    id: 'test',
    is_playable: true,
    name: 'Test Track',
    popularity: 50,
    preview_url: 'https://p.scdn.co/mp3-preview/test',
    track_number: 1,
    type: 'track',
    uri: 'spotify:track:test',
    is_local: false
  }
};

const createMockPlaybackState = (progress: number, isPlaying: boolean = true): SpotifyPlaybackState => ({
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
  progress_ms: progress,
  is_playing: isPlaying,
  item: {
    album: mockTrack.track.album,
    artists: mockTrack.track.artists,
    available_markets: mockTrack.track.available_markets,
    disc_number: mockTrack.track.disc_number,
    duration_ms: mockTrack.track.duration_ms,
    explicit: mockTrack.track.explicit,
    external_ids: {
      isrc: 'USRC12345678',
      ean: '1234567890123',
      upc: '1234567890123'
    },
    external_urls: mockTrack.track.external_urls,
    href: mockTrack.track.href,
    id: mockTrack.track.id,
    is_playable: mockTrack.track.is_playable,
    linked_from: {},
    name: mockTrack.track.name,
    popularity: mockTrack.track.popularity,
    preview_url: mockTrack.track.preview_url || '',
    track_number: mockTrack.track.track_number,
    type: mockTrack.track.type,
    uri: mockTrack.track.uri,
    is_local: mockTrack.track.is_local
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
  }
});

describe('useAutoRemoveFinishedTrack', () => {
  const mockRemoveTrack = jest.fn();
  const mockIsLoading = false;
  const mockError = null;
  const mockIsSuccess = false;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (useRemoveTrackFromPlaylist as jest.Mock).mockReturnValue({
      removeTrack: mockRemoveTrack,
      isLoading: mockIsLoading,
      error: mockError,
      isSuccess: mockIsSuccess
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createMockTracks = (count: number): TrackItem[] => {
    return Array.from({ length: count }, (_, i) => ({
      ...mockTrack,
      track: {
        ...mockTrack.track,
        id: `track-${i}`,
        name: `Track ${i}`
      }
    }));
  };

  const mockPlaybackState: SpotifyPlaybackState = {
    is_playing: true,
    progress_ms: 0,
    device: {
      id: 'test-device',
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: 'Test Device',
      type: 'Computer',
      volume_percent: 100,
      supports_volume: true
    },
    repeat_state: 'off',
    shuffle_state: false,
    timestamp: Date.now(),
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
    item: {
      id: 'track-5',
      name: 'Track 5',
      duration_ms: 180000,
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
        total_tracks: 10,
        available_markets: ['US'],
        external_urls: { spotify: 'https://open.spotify.com/album/test' },
        href: 'https://api.spotify.com/v1/albums/test',
        id: 'test',
        images: [{ height: 640, url: 'https://i.scdn.co/image/test', width: 640 }],
        release_date: '2024-01-01',
        release_date_precision: 'day',
        type: 'album',
        uri: 'spotify:album:test',
        artists: [{
          name: 'Test Artist',
          external_urls: { spotify: 'https://open.spotify.com/artist/test' },
          href: 'https://api.spotify.com/v1/artists/test',
          id: 'test',
          type: 'artist',
          uri: 'spotify:artist:test'
        }]
      },
      available_markets: ['US'],
      disc_number: 1,
      explicit: false,
      external_ids: {
        isrc: 'USRC12345678',
        ean: '1234567890123',
        upc: '1234567890123'
      },
      external_urls: { spotify: 'https://open.spotify.com/track/test' },
      href: 'https://api.spotify.com/v1/tracks/test',
      is_local: false,
      is_playable: true,
      popularity: 50,
      preview_url: 'https://p.scdn.co/mp3-preview/test',
      track_number: 1,
      type: 'track',
      uri: 'spotify:track:test'
    },
    context: {
      type: 'playlist',
      href: 'https://api.spotify.com/v1/playlists/test',
      external_urls: { spotify: 'https://open.spotify.com/playlist/test' },
      uri: 'spotify:playlist:test'
    }
  };

  it('should remove oldest track when current track is at least 5 positions from start', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: tracks,
        playbackState: mockPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).toHaveBeenCalledWith(tracks[0]);
    }, { timeout: 1000 });
  });

  it('should not remove track when current track is less than 5 positions from start', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(4));

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-4',
        playlistTracks: tracks,
        playbackState: mockPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });

  it('should not remove track when it is the currently playing track', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(1));

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-0',
        playlistTracks: tracks,
        playbackState: mockPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });

  it('should not remove track when playback state is null', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: tracks,
        playbackState: null
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });

  it('should not remove track when current track is null', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: null,
        playlistTracks: tracks,
        playbackState: mockPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });

  it('should not remove track when playlist is empty', async () => {
    (filterUpcomingTracks as jest.Mock).mockReturnValue([]);

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: [],
        playbackState: mockPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });

  it('should not remove track when loading', async () => {
    (useRemoveTrackFromPlaylist as jest.Mock).mockReturnValue({
      removeTrack: mockRemoveTrack,
      isLoading: true,
      error: mockError,
      isSuccess: mockIsSuccess
    });

    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: tracks,
        playbackState: mockPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });

  it('should remove track when it has finished playing', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    const finishedPlaybackState: SpotifyPlaybackState = {
      ...mockPlaybackState,
      progress_ms: 180000,
      is_playing: false
    };

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: tracks,
        playbackState: finishedPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).toHaveBeenCalledWith(tracks[0]);
    }, { timeout: 1000 });
  });

  it('should remove track when it is near the end and paused', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    const nearEndPlaybackState: SpotifyPlaybackState = {
      ...mockPlaybackState,
      progress_ms: 170000,
      is_playing: false
    };

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: tracks,
        playbackState: nearEndPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).toHaveBeenCalledWith(tracks[0]);
    }, { timeout: 1000 });
  });

  it('should not remove track when it is still playing', async () => {
    const tracks = createMockTracks(10);
    (filterUpcomingTracks as jest.Mock).mockReturnValue(tracks.slice(5));

    const playingPlaybackState: SpotifyPlaybackState = {
      ...mockPlaybackState,
      progress_ms: 170000,
      is_playing: true
    };

    let result;
    await act(async () => {
      result = renderHook(() => useAutoRemoveFinishedTrack({
        currentTrackId: 'track-5',
        playlistTracks: tracks,
        playbackState: playingPlaybackState
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRemoveTrack).not.toHaveBeenCalled();
    });
  });
}); 