import { PlaylistRefreshServiceImpl } from './playlistRefresh'
import { SpotifyApiClient } from './spotifyApi'
import { SpotifyPlaylistItem, TrackItem } from '@/shared/types'

describe('PlaylistRefreshService', () => {
  let mockSpotifyApi: SpotifyApiClient
  let service: PlaylistRefreshServiceImpl

  beforeEach(() => {
    // Reset the singleton instance before each test
    PlaylistRefreshServiceImpl.resetInstance()

    // Mock Spotify API client
    mockSpotifyApi = {
      getPlaylists: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'playlist1',
            name: '3B Saigon',
            tracks: { items: [] }
          }
        ]
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
      }),
      getQueue: jest.fn().mockResolvedValue({
        currently_playing: null,
        queue: []
      })
    }

    // Initialize service with mock
    service = PlaylistRefreshServiceImpl.getInstance()
    // @ts-ignore - Override private spotifyApi for testing
    service['spotifyApi'] = mockSpotifyApi
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should successfully refresh playlist', async () => {
    // Call refresh playlist
    const result = await service.refreshPlaylist()

    // Verify result
    expect(result.success).toBe(true)
    expect(result.message).toBe('Track added successfully')
  })
})
