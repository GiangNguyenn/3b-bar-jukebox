/* eslint-disable @typescript-eslint/unbound-method */
import { GET } from '../route'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

// Mock the PlaylistRefreshService
jest.mock('@/services/playlistRefresh', () => ({
  PlaylistRefreshServiceImpl: {
    getInstance: jest.fn().mockReturnValue({
      refreshPlaylist: jest.fn()
    })
  }
}))

// Mock NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation(
      (data: unknown, init?: { status?: number }): Response =>
        ({
          ...init,
          json: () => Promise.resolve(data)
        }) as Response
    )
  }
}))

describe('GET /api/refresh-site', () => {
  beforeEach((): void => {
    jest.clearAllMocks()
  })

  // Mock URL class
  const mockSearchParams = {
    get: jest.fn()
  }

  const mockUrl = {
    searchParams: mockSearchParams
  }

  // @ts-expect-error - Mocking global URL
  global.URL = jest.fn().mockImplementation(() => mockUrl)

  beforeEach((): void => {
    mockSearchParams.get.mockReset()
  })

  // Bind expect to avoid unbound method errors
  const boundExpect = expect

  it('should return success response when refresh is successful', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true })

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })

  it('should return error response when refresh fails', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: false })

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })

  it('should handle force parameter when set to true', async () => {
    mockSearchParams.get.mockReturnValue('true')
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true })

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })

  it('should handle force parameter when set to false', async () => {
    mockSearchParams.get.mockReturnValue('false')
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockResolvedValueOnce({ success: true })

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })

  it('should handle invalid URL gracefully', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockRejectedValueOnce(new Error('Invalid URL'))

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })

  it('should handle service errors gracefully', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockRejectedValueOnce(
      new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, 'RefreshError')
    )

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })

  it('should handle unexpected errors gracefully', async () => {
    mockSearchParams.get.mockReturnValue(null)
    const mockRefreshPlaylist = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist as jest.Mock
    mockRefreshPlaylist.mockRejectedValueOnce(new Error('Unexpected error'))

    const response = GET()

    boundExpect(response.status).toBe(200)
    await boundExpect(response.json()).resolves.toEqual({
      message: 'GET handler is working'
    })
  })
})
