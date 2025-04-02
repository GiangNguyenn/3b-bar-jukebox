import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useAutoRemoveFinishedTrack } from '../useAutoRemoveFinishedTrack';
import { useRemoveTrackFromPlaylist } from '../useRemoveTrackFromPlaylist';
import { TrackItem, SpotifyPlaybackState } from '@/shared/types';

// Mock the useRemoveTrackFromPlaylist hook
jest.mock('../useRemoveTrackFromPlaylist', () => ({
  useRemoveTrackFromPlaylist: jest.fn(),
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
  context: {
    type: 'playlist',
    href: 'https://api.spotify.com/v1/playlists/test',
    external_urls: { spotify: 'https://open.spotify.com/playlist/test' },
    uri: 'spotify:playlist:test'
  },
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
    (useRemoveTrackFromPlaylist as jest.Mock).mockReturnValue({
      removeTrack: mockRemoveTrack,
      isLoading: mockIsLoading,
      error: mockError,
      isSuccess: mockIsSuccess
    });
  });

  it('should not remove track when playback state is null', () => {
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'test',
      playlistTracks: [mockTrack],
      playbackState: null
    }));

    expect(mockRemoveTrack).not.toHaveBeenCalled();
  });

  it('should not remove track when current track is not found', () => {
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'non-existent',
      playlistTracks: [mockTrack],
      playbackState: createMockPlaybackState(0)
    }));

    expect(mockRemoveTrack).not.toHaveBeenCalled();
  });

  it('should remove track when it has finished playing', () => {
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'test',
      playlistTracks: [mockTrack],
      playbackState: createMockPlaybackState(180000) // At the end of the track
    }));

    expect(mockRemoveTrack).toHaveBeenCalledWith(mockTrack);
  });

  it('should remove track when it is near the end and paused', () => {
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'test',
      playlistTracks: [mockTrack],
      playbackState: createMockPlaybackState(179000, false) // Near the end and paused
    }));

    expect(mockRemoveTrack).toHaveBeenCalledWith(mockTrack);
  });

  it('should not remove track when it is still playing', () => {
    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'test',
      playlistTracks: [mockTrack],
      playbackState: createMockPlaybackState(90000) // Middle of the track
    }));

    expect(mockRemoveTrack).not.toHaveBeenCalled();
  });

  it('should not remove track when loading', () => {
    (useRemoveTrackFromPlaylist as jest.Mock).mockReturnValue({
      removeTrack: mockRemoveTrack,
      isLoading: true,
      error: mockError,
      isSuccess: mockIsSuccess
    });

    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'test',
      playlistTracks: [mockTrack],
      playbackState: createMockPlaybackState(180000)
    }));

    expect(mockRemoveTrack).not.toHaveBeenCalled();
  });

  it('should remove oldest track when current track is more than 5 tracks from start', () => {
    const oldestTrack = { ...mockTrack, track: { ...mockTrack.track, id: 'oldest' } };
    const tracks = Array(7).fill(mockTrack).map((track, index) => ({
      ...track,
      track: { ...track.track, id: `track-${index}` }
    }));

    renderHook(() => useAutoRemoveFinishedTrack({
      currentTrackId: 'track-6',
      playlistTracks: tracks,
      playbackState: createMockPlaybackState(0)
    }));

    expect(mockRemoveTrack).toHaveBeenCalledWith(tracks[0]);
  });
}); 