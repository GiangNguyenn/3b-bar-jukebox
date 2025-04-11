import { GET } from '../route'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

// Mock the PlaylistRefreshService
jest.mock('@/services/playlistRefresh', () => ({
  PlaylistRefreshServiceImpl: {
    getInstance: jest.fn().mockReturnValue({
      refreshPlaylist: jest.fn(),
    }),
  },
}))

// Mock NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, init) => ({
      ...init,
      json: () => Promise.resolve(data),
    })),
  },
}))

describe('GET /api/refresh-site', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const createRequest = (path: string, params?: Record<string, string>) => {
    const baseUrl = 'http://localhost:3000'
    let fullUrl = `${baseUrl}${path}`
    if (params) {
      const searchParams = new URLSearchParams(params).toString()
      fullUrl = `${fullUrl}?${searchParams}`
    }
    return new Request(fullUrl, {
      method: 'GET',
    })
  }

  // Mock URL class
  const mockSearchParams = {
    get: jest.fn(),
  }

  const mockUrl = {
    searchParams: mockSearchParams,
  }

  // @ts-ignore
  global.URL = jest.fn().mockImplementation(() => mockUrl)

  beforeEach(() => {
    mockSearchParams.get.mockReset()
  })

  it('should return success response when refresh is successful', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true })

    const request = createRequest('/api/refresh-site')
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockRefreshPlaylist).toHaveBeenCalledWith(false)
  })

  it('should return error response when refresh fails', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: false })

    const request = createRequest('/api/refresh-site')
    const response = await GET(request)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false })
    expect(mockRefreshPlaylist).toHaveBeenCalledWith(false)
  })

  it('should handle force parameter when set to true', async () => {
    mockSearchParams.get.mockReturnValue('true')
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true })

    const request = createRequest('/api/refresh-site', { force: 'true' })
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockRefreshPlaylist).toHaveBeenCalledWith(true)
  })

  it('should handle force parameter when set to false', async () => {
    mockSearchParams.get.mockReturnValue('false')
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true })

    const request = createRequest('/api/refresh-site', { force: 'false' })
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockRefreshPlaylist).toHaveBeenCalledWith(false)
  })

  it('should handle invalid URL gracefully', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockRejectedValueOnce(new Error('Invalid URL'))

    const request = new Request('invalid-url')
    const response = await GET(request)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      message: 'Invalid URL',
    })
  })

  it('should handle service errors gracefully', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockRejectedValueOnce(
      new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, 'RefreshError'),
    )

    const request = createRequest('/api/refresh-site')
    const response = await GET(request)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      message: 'Failed to load playlist',
    })
  })

  it('should handle unexpected errors gracefully', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockRejectedValueOnce(new Error('Unexpected error'))

    const request = createRequest('/api/refresh-site')
    const response = await GET(request)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      message: 'Unexpected error',
    })
  })
})
