import { renderHook, act } from '@testing-library/react-hooks';
import { useCreateNewDailyPlaylist } from '../useCreateNewDailyPlayList';
import { useMyPlaylists } from '../useMyPlaylists';
import { sendApiRequest } from '@/shared/api';
import { formatDateForPlaylist } from '@/shared/utils/date';

// Mock the dependencies
jest.mock('../useMyPlaylists');
jest.mock('@/shared/api');

const mockUseMyPlaylists = useMyPlaylists as jest.MockedFunction<typeof useMyPlaylists>;
const mockSendApiRequest = sendApiRequest as jest.MockedFunction<typeof sendApiRequest>;

describe('useCreateNewDailyPlaylist', () => {
  const todayString = formatDateForPlaylist();
  const expectedName = `Daily Mix - ${todayString}`;
  const mockExistingPlaylist = {
    id: 'existing-playlist-id',
    name: expectedName,
    description: `A daily mix of your favorite songs on ${todayString}`,
    public: false,
    collaborative: false,
    external_urls: { spotify: 'https://spotify.com/playlist/existing' },
    href: 'https://api.spotify.com/v1/playlists/existing',
    images: [],
    owner: {
      display_name: 'Test User',
      external_urls: { spotify: 'https://spotify.com/user/test' },
      href: 'https://api.spotify.com/v1/users/test',
      id: 'test-user',
      type: 'user',
      uri: 'spotify:user:test',
      followers: {
        href: null,
        total: 0
      }
    },
    primary_color: null,
    snapshot_id: 'test-snapshot',
    tracks: { 
      total: 0,
      href: 'https://api.spotify.com/v1/playlists/existing/tracks',
      items: [],
      limit: 100,
      offset: 0
    },
    type: 'playlist',
    uri: 'spotify:playlist:existing'
  };

  const mockPlaylistsResponse = {
    href: 'https://api.spotify.com/v1/me/playlists',
    items: [],
    limit: 50,
    next: null,
    offset: 0,
    previous: null,
    total: 0
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation
    mockUseMyPlaylists.mockReturnValue({
      data: mockPlaylistsResponse,
      isLoading: false,
      isError: false,
      refetchPlaylists: jest.fn().mockResolvedValue(mockPlaylistsResponse)
    });
  });

  it('should not create a new playlist if one with the same name exists', async () => {
    // Mock that we have an existing playlist
    mockUseMyPlaylists.mockReturnValue({
      data: { ...mockPlaylistsResponse, items: [mockExistingPlaylist] },
      isLoading: false,
      isError: false,
      refetchPlaylists: jest.fn().mockResolvedValue({ ...mockPlaylistsResponse, items: [mockExistingPlaylist] })
    });

    const { result, waitForNextUpdate } = renderHook(() => useCreateNewDailyPlaylist());

    // Wait for initial fetch to complete
    await waitForNextUpdate();

    // Attempt to create a playlist
    let createdPlaylist = null;
    await act(async () => {
      createdPlaylist = await result.current.createPlaylist();
    });

    // Verify that no new playlist was created
    expect(createdPlaylist).toBeNull();
    expect(mockSendApiRequest).not.toHaveBeenCalled();
    expect(result.current.todayPlaylistId).toBe('existing-playlist-id');
  });

  it('should create a new playlist if no existing playlist is found', async () => {
    const mockNewPlaylist = {
      ...mockExistingPlaylist,
      id: 'new-playlist-id',
      uri: 'spotify:playlist:new'
    };

    // Mock that we have no existing playlists
    mockUseMyPlaylists.mockReturnValue({
      data: mockPlaylistsResponse,
      isLoading: false,
      isError: false,
      refetchPlaylists: jest.fn().mockResolvedValue(mockPlaylistsResponse)
    });

    // Mock the API response for creating a new playlist
    mockSendApiRequest.mockResolvedValueOnce(mockNewPlaylist);

    const { result, waitForNextUpdate } = renderHook(() => useCreateNewDailyPlaylist());

    // Wait for initial fetch to complete
    await waitForNextUpdate();

    // Attempt to create a playlist
    let createdPlaylist = null;
    await act(async () => {
      createdPlaylist = await result.current.createPlaylist();
    });

    // Verify that a new playlist was created
    expect(createdPlaylist).toEqual(mockNewPlaylist);
    expect(mockSendApiRequest).toHaveBeenCalledWith({
      path: 'me/playlists',
      method: 'POST',
      body: {
        name: expectedName,
        description: `A daily mix of your favorite songs on ${todayString}`,
        public: false
      }
    });
    expect(result.current.todayPlaylistId).toBe('new-playlist-id');
  });

  it('should not create a playlist if initial fetch is not complete', async () => {
    // Mock that we're still loading
    mockUseMyPlaylists.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetchPlaylists: jest.fn()
    });

    const { result } = renderHook(() => useCreateNewDailyPlaylist());

    // Attempt to create a playlist before initial fetch is complete
    let createdPlaylist = null;
    await act(async () => {
      createdPlaylist = await result.current.createPlaylist();
    });

    // Verify that no playlist was created
    expect(createdPlaylist).toBeNull();
    expect(mockSendApiRequest).not.toHaveBeenCalled();
  });

  it('should not create a playlist if we already attempted creation', async () => {
    const mockNewPlaylist = {
      ...mockExistingPlaylist,
      id: 'new-playlist-id',
      uri: 'spotify:playlist:new'
    };

    // Mock that we have no existing playlists
    mockUseMyPlaylists.mockReturnValue({
      data: mockPlaylistsResponse,
      isLoading: false,
      isError: false,
      refetchPlaylists: jest.fn().mockResolvedValue(mockPlaylistsResponse)
    });

    // Mock the API response for creating a new playlist
    mockSendApiRequest.mockResolvedValueOnce(mockNewPlaylist);

    const { result, waitForNextUpdate } = renderHook(() => useCreateNewDailyPlaylist());

    // Wait for initial fetch to complete
    await waitForNextUpdate();

    // First creation attempt
    await act(async () => {
      await result.current.createPlaylist();
    });

    // Second creation attempt
    let secondAttempt = null;
    await act(async () => {
      secondAttempt = await result.current.createPlaylist();
    });

    // Verify that only one playlist was created
    expect(secondAttempt).toBeNull();
    expect(mockSendApiRequest).toHaveBeenCalledTimes(1);
  });
}); 