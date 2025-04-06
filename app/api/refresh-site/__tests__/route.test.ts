import { GET } from '../route';
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh';

// Mock the PlaylistRefreshService
jest.mock('@/services/playlistRefresh', () => ({
  PlaylistRefreshServiceImpl: {
    getInstance: jest.fn().mockReturnValue({
      refreshPlaylist: jest.fn()
    })
  }
}));

// Mock NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, init) => ({
      ...init,
      json: () => Promise.resolve(data)
    }))
  }
}));

describe('GET /api/refresh-site', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return success response when refresh is successful', async () => {
    // Mock the refreshPlaylist to return success
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance().refreshPlaylist as jest.Mock;
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true });

    // Create a mock request
    const request = { url: 'http://localhost/api/refresh-site' } as Request;

    // Call the route handler
    const response = await GET(request);

    // Verify the response
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('should return error response when refresh fails', async () => {
    // Mock the refreshPlaylist to return failure
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance().refreshPlaylist as jest.Mock;
    mockRefreshPlaylist.mockResolvedValueOnce({ success: false });

    // Create a mock request
    const request = { url: 'http://localhost/api/refresh-site' } as Request;

    // Call the route handler
    const response = await GET(request);

    // Verify the response
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false });
  });
}); 