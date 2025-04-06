import { PlaylistRefreshServiceImpl } from '../playlistRefresh';
import { SpotifyApiService } from '../spotifyApi';
import { SpotifyPlaylistItem, TrackItem } from '@/shared/types';

// Mock sendApiRequest
jest.mock('@/shared/api', () => ({
  sendApiRequest: jest.fn().mockResolvedValue({})
}));

// Mock SpotifyApiService
jest.mock('../spotifyApi', () => ({
  SpotifyApiService: {
    getInstance: jest.fn().mockReturnValue({
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
    })
  }
}));

// Mock findSuggestedTrack
jest.mock('@/services/trackSuggestion', () => ({
  findSuggestedTrack: jest.fn().mockResolvedValue({
    track: {
      id: 'suggestedTrack1',
      uri: 'spotify:track:suggestedTrack1',
      name: 'Suggested Track'
    },
    searchDetails: {}
  })
}));

describe('PlaylistRefreshService', () => {
  let service: PlaylistRefreshServiceImpl;

  beforeEach(() => {
    service = PlaylistRefreshServiceImpl.getInstance();
    jest.clearAllMocks();
  });

  it('should successfully refresh playlist', async () => {
    const result = await service.refreshPlaylist();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Track added successfully');
  });

  it('should get upcoming tracks', () => {
    const playlist: SpotifyPlaylistItem = {
      id: 'playlist1',
      name: 'Test Playlist',
      tracks: {
        items: [
          { track: { id: 'track1' } },
          { track: { id: 'track2' } },
          { track: { id: 'track3' } }
        ]
      }
    } as SpotifyPlaylistItem;

    const result = service.getUpcomingTracks(playlist, 'track1');
    expect(result).toHaveLength(2);
    expect(result[0].track.id).toBe('track2');
    expect(result[1].track.id).toBe('track3');
  });

  it('should handle auto remove track', async () => {
    const result = await service.autoRemoveFinishedTrack({
      playlistId: 'playlist1',
      currentTrackId: 'track6', // Current track is at index 5
      playlistTracks: [
        { track: { id: 'track1', uri: 'spotify:track:track1', name: 'Track 1' } },
        { track: { id: 'track2', uri: 'spotify:track:track2', name: 'Track 2' } },
        { track: { id: 'track3', uri: 'spotify:track:track3', name: 'Track 3' } },
        { track: { id: 'track4', uri: 'spotify:track:track4', name: 'Track 4' } },
        { track: { id: 'track5', uri: 'spotify:track:track5', name: 'Track 5' } },
        { track: { id: 'track6', uri: 'spotify:track:track6', name: 'Track 6' } }
      ] as TrackItem[],
      playbackState: { is_playing: true } as any
    });

    expect(result).toBe(true);
  });
}); 