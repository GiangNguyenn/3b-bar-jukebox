import { PlaylistRefreshServiceImpl } from '../playlistRefresh'
import { SpotifyApiService } from '../spotifyApi'
import { findSuggestedTrack } from '@/services/trackSuggestion'
import {
  SpotifyPlaybackState,
  SpotifyPlaylistItem,
  TrackItem,
  TrackDetails
} from '@/shared/types'

const MOCK_MARKET = 'US'
const FIXED_PLAYLIST_NAME = '3B Saigon'

// Mock sendApiRequest
jest.mock('@/shared/api', () => ({
  sendApiRequest: jest.fn().mockResolvedValue({})
}))

// Mock SpotifyApiService
jest.mock('../spotifyApi', () => ({
  SpotifyApiService: {
    getInstance: jest.fn()
  }
}))

// Mock findSuggestedTrack
jest.mock('@/services/trackSuggestion', () => ({
  findSuggestedTrack: jest.fn()
}))

describe('PlaylistRefreshService', () => {
  let service: PlaylistRefreshServiceImpl
  let mockFindSuggestedTrack: jest.Mock
  let mockSpotifyApi: any

  beforeEach(() => {
    jest.clearAllMocks()
    PlaylistRefreshServiceImpl.resetInstance()

    // Setup default mock response for findSuggestedTrack
    mockFindSuggestedTrack = findSuggestedTrack as jest.Mock
    mockFindSuggestedTrack.mockResolvedValue({
      track: {
        id: 'suggestedTrack1',
        uri: 'spotify:track:suggestedTrack1',
        name: 'Suggested Track',
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album' },
        popularity: 80,
        duration_ms: 180000,
        preview_url: null
      },
      searchDetails: {
        attempts: 1,
        totalTracksFound: 1,
        excludedTrackIds: [],
        minPopularity: 50,
        genresTried: ['rock'],
        trackDetails: []
      }
    })

    mockSpotifyApi = {
      getPlaylists: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'playlist1',
            name: FIXED_PLAYLIST_NAME,
            tracks: { items: [] }
          }
        ]
      }),
      getPlaylist: jest.fn().mockResolvedValue({
        id: 'playlist1',
        name: FIXED_PLAYLIST_NAME,
        tracks: { items: [] }
      }),
      getCurrentlyPlaying: jest.fn().mockResolvedValue({
        item: { id: 'track1' }
      }),
      addTrackToPlaylist: jest.fn().mockResolvedValue(undefined),
      getPlaybackState: jest.fn().mockResolvedValue({
        is_playing: true,
        context: { uri: 'spotify:playlist:playlist1' },
        item: { uri: 'spotify:track:track1' },
        progress_ms: 0
      })
    }
    ;(SpotifyApiService.getInstance as jest.Mock).mockReturnValue(
      mockSpotifyApi
    )
    service = PlaylistRefreshServiceImpl.getInstance()
  })

  afterEach(() => {
    jest.clearAllMocks()
    PlaylistRefreshServiceImpl.resetInstance()
  })

  it('should successfully refresh playlist', async () => {
    const result = await service.refreshPlaylist()
    expect(result.success).toBe(true)
    expect(result.message).toBe('Track added successfully')
  })

  it('should exclude current track and all playlist tracks from suggestions', async () => {
    const mockPlaylist = {
      id: 'playlist1',
      name: FIXED_PLAYLIST_NAME,
      tracks: {
        items: [{ track: { id: 'track1' } }, { track: { id: 'track2' } }]
      }
    } as SpotifyPlaylistItem

    mockSpotifyApi.getPlaylists.mockResolvedValue({ items: [mockPlaylist] })
    mockSpotifyApi.getPlaylist.mockResolvedValue(mockPlaylist)
    mockSpotifyApi.getCurrentlyPlaying.mockResolvedValue({
      item: { id: 'currentTrack' }
    })

    // Mock findSuggestedTrack to return a valid track
    mockFindSuggestedTrack.mockResolvedValueOnce({
      track: {
        id: 'suggestedTrack1',
        uri: 'spotify:track:suggestedTrack1',
        name: 'Suggested Track',
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album' },
        popularity: 80,
        duration_ms: 180000,
        preview_url: null
      },
      searchDetails: {
        attempts: 1,
        totalTracksFound: 1,
        excludedTrackIds: ['track1', 'track2', 'currentTrack'],
        minPopularity: 50,
        genresTried: ['rock'],
        trackDetails: []
      }
    })

    await service.refreshPlaylist()

    // Verify that findSuggestedTrack was called with the correct parameters
    const findSuggestedTrackCalls = mockFindSuggestedTrack.mock.calls
    expect(findSuggestedTrackCalls.length).toBe(1)
    expect(findSuggestedTrackCalls[0][0]).toEqual(['track1', 'track2'])
    expect(findSuggestedTrackCalls[0][1]).toBe('currentTrack')
    expect(findSuggestedTrackCalls[0][2]).toBe(MOCK_MARKET)
    expect(findSuggestedTrackCalls[0][3]).toEqual(expect.any(Object))
  })

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
    } as SpotifyPlaylistItem

    const result = service.getUpcomingTracks(playlist, 'track1')
    expect(result).toHaveLength(2)
    expect(result[0].track.id).toBe('track2')
    expect(result[1].track.id).toBe('track3')
  })

  it('should handle auto remove track', async () => {
    const result = await service.autoRemoveFinishedTrack({
      playlistId: 'playlist1',
      currentTrackId: 'track21', // Current track is at index 20
      playlistTracks: Array.from({ length: 25 }, (_, i) => ({
        track: {
          id: `track${i + 1}`,
          uri: `spotify:track:track${i + 1}`,
          name: `Track ${i + 1}`
        }
      })) as TrackItem[],
      playbackState: { is_playing: true } as any
    })

    expect(result).toBe(true)
  })

  it('should not add track when playlist has reached maximum length', async () => {
    const playlist: SpotifyPlaylistItem = {
      id: 'playlist1',
      name: FIXED_PLAYLIST_NAME,
      tracks: {
        items: [
          { track: { id: 'track1' } },
          { track: { id: 'track2' } },
          { track: { id: 'track3' } },
          { track: { id: 'track4' } },
          { track: { id: 'track5' } }
        ]
      }
    } as SpotifyPlaylistItem

    mockSpotifyApi.getPlaylists.mockResolvedValue({ items: [playlist] })
    mockSpotifyApi.getPlaylist.mockResolvedValue(playlist)
    mockSpotifyApi.getCurrentlyPlaying.mockResolvedValue({
      item: { id: 'track1' }
    })

    const result = await service.refreshPlaylist()

    expect(result.success).toBe(false)
    expect(result.message).toBe(
      'Playlist has reached maximum length of 2 tracks. No new tracks needed.'
    )
  })
})
