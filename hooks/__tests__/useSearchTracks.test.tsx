import { renderHook, act } from '@testing-library/react-hooks';
import useSearchTracks from '../useSearchTracks';
import { sendApiRequest } from '@/shared/api';
import { TrackDetails } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { AppError } from '@/shared/utils/errorHandling';

jest.mock('@/shared/api');

const mockSendApiRequest = sendApiRequest as jest.MockedFunction<typeof sendApiRequest>;

describe('useSearchTracks', () => {
  const mockTrack: TrackDetails = {
    id: 'test-track',
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
    is_local: false,
    popularity: 50,
    preview_url: 'https://preview.spotify.com/test',
    track_number: 1,
    type: 'track',
    uri: 'spotify:track:test',
    available_markets: ['US'],
    disc_number: 1,
    external_ids: {},
    is_playable: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendApiRequest.mockResolvedValue({ tracks: { items: [mockTrack] } });
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSearchTracks());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should search tracks successfully', async () => {
    const { result } = renderHook(() => useSearchTracks());

    let searchResult: TrackDetails[] = [];
    await act(async () => {
      searchResult = await result.current.searchTracks('test query');
    });

    expect(mockSendApiRequest).toHaveBeenCalledWith({
      path: 'search?q=test query&type=track&limit=20',
      method: 'GET',
    });
    expect(searchResult).toEqual([mockTrack]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle API error', async () => {
    mockSendApiRequest.mockRejectedValue(new Error('API Error'));

    const { result } = renderHook(() => useSearchTracks());

    let searchResult: TrackDetails[] = [];
    await act(async () => {
      searchResult = await result.current.searchTracks('test query');
    });

    expect(searchResult).toEqual([]);
    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle empty search query', async () => {
    mockSendApiRequest.mockResolvedValueOnce({ tracks: { items: [] } });

    const { result } = renderHook(() => useSearchTracks());

    let searchResult: TrackDetails[] = [];
    await act(async () => {
      searchResult = await result.current.searchTracks('');
    });

    expect(searchResult).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle malformed API response', async () => {
    mockSendApiRequest.mockResolvedValue({ tracks: { items: null } });

    const { result } = renderHook(() => useSearchTracks());

    let searchResult: TrackDetails[] = [];
    await act(async () => {
      searchResult = await result.current.searchTracks('test query');
    });

    expect(searchResult).toEqual([]);
    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.isLoading).toBe(false);
  });
}); 