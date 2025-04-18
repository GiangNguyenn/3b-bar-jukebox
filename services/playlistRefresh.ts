import {
  SpotifyPlaylistItem,
  TrackItem,
  SpotifyPlaybackState
} from '@/shared/types'
import { SpotifyApiClient, SpotifyApiService } from './spotifyApi'
import {
  COOLDOWN_MS,
  MAX_PLAYLIST_LENGTH
} from '@/shared/constants/trackSuggestion'
import { findSuggestedTrack, Genre } from '@/services/trackSuggestion'
import { filterUpcomingTracks } from '@/lib/utils'
import { autoRemoveTrack } from '@/shared/utils/autoRemoveTrack'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { DEFAULT_MARKET } from '@/shared/constants/trackSuggestion'
import { sendApiRequest } from '@/shared/api'

export interface PlaylistRefreshService {
  refreshPlaylist(force?: boolean): Promise<{
    success: boolean
    message: string
    timestamp: string
    diagnosticInfo?: Record<string, unknown>
    forceRefresh?: boolean
    playerStateRefresh?: boolean
  }>
  getUpcomingTracks(
    playlist: SpotifyPlaylistItem,
    currentTrackId: string | null
  ): TrackItem[]
  autoRemoveFinishedTrack(params: {
    playlistId: string
    currentTrackId: string | null
    playlistTracks: TrackItem[]
    playbackState: SpotifyPlaybackState | null
  }): Promise<boolean>
  getLastSuggestedTrack(): {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
  } | null
  refreshTrackSuggestions(params: {
    genres: Genre[]
    yearRange: [number, number]
    popularity: number
    allowExplicit: boolean
    maxSongLength: number
    songsBetweenRepeats: number
  }): Promise<{
    success: boolean
    message: string
    searchDetails?: {
      attempts: number
      totalTracksFound: number
      excludedTrackIds: string[]
      minPopularity: number
      genresTried: string[]
      trackDetails: Array<{
        name: string
        popularity: number
        isExcluded: boolean
        isPlayable: boolean
        duration_ms: number
        explicit: boolean
      }>
    }
    diagnosticInfo?: {
      playlistLength: number
      upcomingTracksCount: number
      currentTrackId: string | null
      genresUsed: string[]
      timestamp: string
    }
  }>
}

export class PlaylistRefreshServiceImpl implements PlaylistRefreshService {
  private static instance: PlaylistRefreshServiceImpl
  private lastAddTime: number = 0
  private readonly MAX_RETRIES = 3
  private readonly RETRY_DELAY_MS = 1000
  private readonly FIXED_PLAYLIST_NAME = '3B Saigon'
  private readonly spotifyApi: SpotifyApiClient
  private lastSuggestedTrack: {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
  } | null = null
  private isRefreshing = false

  private constructor() {
    this.spotifyApi = SpotifyApiService.getInstance()
  }

  public static getInstance(): PlaylistRefreshServiceImpl {
    if (!PlaylistRefreshServiceImpl.instance) {
      PlaylistRefreshServiceImpl.instance = new PlaylistRefreshServiceImpl()
    }
    return PlaylistRefreshServiceImpl.instance
  }

  // For testing purposes only
  public static resetInstance(): void {
    PlaylistRefreshServiceImpl.instance = undefined as any
  }

  private async getFixedPlaylist(): Promise<SpotifyPlaylistItem | null> {
    const playlists = await this.spotifyApi.getPlaylists()
    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === this.FIXED_PLAYLIST_NAME
    )

    if (!fixedPlaylist) {
      return null
    }

    return this.spotifyApi.getPlaylist(fixedPlaylist.id)
  }

  private async getCurrentlyPlaying(): Promise<{
    id: string | null
    error?: string
  }> {
    try {
      const response = await this.spotifyApi.getCurrentlyPlaying()
      return { id: response.item?.id ?? null }
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        return {
          id: null,
          error:
            'Spotify authentication failed. Please check your access token.'
        }
      }
      return { id: null }
    }
  }

  private async tryAddTrack(
    trackUri: string,
    playlistId: string
  ): Promise<boolean> {
    try {
      await this.spotifyApi.addTrackToPlaylist(playlistId, trackUri)
      return true
    } catch (error) {
      throw error
    }
  }

  private async addSuggestedTrackToPlaylist(
    upcomingTracks: TrackItem[],
    playlistId: string,
    currentTrackId: string | null,
    allPlaylistTracks: TrackItem[],
    params?: {
      genres: Genre[]
      yearRange: [number, number]
      popularity: number
      allowExplicit: boolean
      maxSongLength: number
      songsBetweenRepeats: number
    }
  ): Promise<{ success: boolean; error?: string; searchDetails?: unknown }> {
    console.log(
      '[PARAM CHAIN] Genres received in addSuggestedTrackToPlaylist (playlistRefresh.ts):',
      params?.genres
    )
    const existingTrackIds = allPlaylistTracks.map((t) => t.track.id)
    const now = Date.now()

    if (now - this.lastAddTime < COOLDOWN_MS) {
      return { success: false, error: 'In cooldown period' }
    }

    if (upcomingTracks.length > MAX_PLAYLIST_LENGTH) {
      return { success: false, error: 'Playlist too long' }
    }

    try {
      let retryCount = 0
      let success = false
      let searchDetails: unknown

      while (!success && retryCount < this.MAX_RETRIES) {
        console.log(
          '[PARAM CHAIN] Passing genres to findSuggestedTrack (playlistRefresh.ts):',
          params?.genres
        )
        const result = await findSuggestedTrack(
          existingTrackIds,
          currentTrackId,
          DEFAULT_MARKET,
          params
        )

        if (!result.track) {
          retryCount++
          continue
        }

        success = await this.tryAddTrack(result.track.uri, playlistId)
        searchDetails = {
          ...result.searchDetails,
          trackDetails: result.searchDetails.trackDetails
        }

        if (success) {
          this.lastSuggestedTrack = {
            name: result.track.name,
            artist: result.track.artists[0].name,
            album: result.track.album.name,
            uri: result.track.uri,
            popularity: result.track.popularity,
            duration_ms: result.track.duration_ms,
            preview_url: result.track.preview_url ?? null
          }

          // Get current playback state to resume at the same position
          const playbackState = await this.spotifyApi.getPlaybackState()
          if (playbackState?.context?.uri && playbackState?.item?.uri) {
            // Resume playback at the exact same track and position
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: playbackState.context.uri,
                offset: { uri: playbackState.item.uri },
                position_ms: playbackState.progress_ms ?? 0
              }
            })
          }
        } else {
          retryCount++
          await new Promise((resolve) =>
            setTimeout(resolve, this.RETRY_DELAY_MS * Math.pow(2, retryCount))
          )
        }
      }

      if (success) {
        this.lastAddTime = now
        return { success: true, searchDetails }
      }

      return { success: false, error: 'Failed to add track after retries' }
    } catch (error) {
      console.error(
        '[PlaylistRefresh] Error in addSuggestedTrackToPlaylist:',
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  getUpcomingTracks(
    playlist: SpotifyPlaylistItem,
    currentTrackId: string | null
  ): TrackItem[] {
    return filterUpcomingTracks(playlist.tracks.items, currentTrackId)
  }

  async autoRemoveFinishedTrack(params: {
    playlistId: string
    currentTrackId: string | null
    playlistTracks: TrackItem[]
    playbackState: SpotifyPlaybackState | null
  }): Promise<boolean> {
    return handleOperationError(
      async () =>
        autoRemoveTrack({
          ...params,
          onSuccess: () => {
            // Remove console.log
          },
          onError: (error) => {
            console.error(
              '[PlaylistRefresh] Error removing finished track:',
              error
            )
          }
        }),
      'PlaylistRefresh.autoRemoveFinishedTrack'
    )
  }

  async refreshPlaylist(
    force = false,
    params?: {
      genres: Genre[]
      yearRange: [number, number]
      popularity: number
      allowExplicit: boolean
      maxSongLength: number
      songsBetweenRepeats: number
    }
  ): Promise<{
    success: boolean
    message: string
    timestamp: string
    diagnosticInfo?: Record<string, unknown>
    forceRefresh?: boolean
    playerStateRefresh?: boolean
  }> {
    try {
      const playlist = await this.getFixedPlaylist()

      if (!playlist) {
        return {
          success: false,
          message: `No playlist found with name: ${this.FIXED_PLAYLIST_NAME}`,
          timestamp: new Date().toISOString()
        }
      }

      const { id: currentTrackId, error: playbackError } =
        await this.getCurrentlyPlaying()

      if (playbackError) {
        return {
          success: false,
          message: playbackError,
          timestamp: new Date().toISOString()
        }
      }

      const upcomingTracks = this.getUpcomingTracks(playlist, currentTrackId)

      const playbackState = await this.spotifyApi.getPlaybackState()
      const removedTrack = await this.autoRemoveFinishedTrack({
        playlistId: playlist.id,
        currentTrackId,
        playlistTracks: playlist.tracks.items,
        playbackState
      })

      const diagnosticInfo = {
        currentTrackId,
        totalTracks: playlist.tracks.items.length,
        upcomingTracksCount: upcomingTracks.length,
        playlistTrackIds: playlist.tracks.items.map((t) => t.track.id),
        upcomingTrackIds: upcomingTracks.map((t) => t.track.id),
        removedTrack,
        addedTrack: false
      }

      const result = await this.addSuggestedTrackToPlaylist(
        upcomingTracks,
        playlist.id,
        currentTrackId,
        playlist.tracks.items,
        params
      )

      if (!result.success) {
        return {
          success: true,
          message:
            result.error === 'Playlist too long'
              ? `Playlist has reached maximum length of ${MAX_PLAYLIST_LENGTH} tracks. No new tracks needed.`
              : result.error || 'Failed to add track',
          timestamp: new Date().toISOString(),
          diagnosticInfo,
          forceRefresh: force
        }
      }

      diagnosticInfo.addedTrack = true

      return {
        success: true,
        message: 'Track added successfully',
        timestamp: new Date().toISOString(),
        diagnosticInfo,
        forceRefresh: force
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    }
  }

  getLastSuggestedTrack(): {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
  } | null {
    return this.lastSuggestedTrack
  }

  async refreshTrackSuggestions(params: {
    genres: Genre[]
    yearRange: [number, number]
    popularity: number
    allowExplicit: boolean
    maxSongLength: number
    songsBetweenRepeats: number
  }): Promise<{
    success: boolean
    message: string
    searchDetails?: {
      attempts: number
      totalTracksFound: number
      excludedTrackIds: string[]
      minPopularity: number
      genresTried: string[]
      trackDetails: Array<{
        name: string
        popularity: number
        isExcluded: boolean
        isPlayable: boolean
        duration_ms: number
        explicit: boolean
      }>
    }
    diagnosticInfo?: {
      playlistLength: number
      upcomingTracksCount: number
      currentTrackId: string | null
      genresUsed: string[]
      timestamp: string
    }
  }> {
    console.log(
      '[PARAM CHAIN] Genres received in refreshTrackSuggestions (playlistRefresh.ts):',
      params.genres
    )
    if (this.isRefreshing) {
      return {
        success: false,
        message: 'Refresh already in progress'
      }
    }

    try {
      this.isRefreshing = true

      const playlist = await this.getFixedPlaylist()
      if (!playlist) {
        return {
          success: false,
          message: 'Fixed playlist not found'
        }
      }

      const { id: currentTrackId } = await this.getCurrentlyPlaying()
      const upcomingTracks = this.getUpcomingTracks(playlist, currentTrackId)
      const allPlaylistTracks = playlist.tracks.items

      console.log(
        '[PARAM CHAIN] Passing genres to addSuggestedTrackToPlaylist (playlistRefresh.ts):',
        params.genres
      )
      const result = await this.addSuggestedTrackToPlaylist(
        upcomingTracks,
        playlist.id,
        currentTrackId,
        allPlaylistTracks,
        params
      )

      if (!result.success) {
        return {
          success: false,
          message: result.error || 'Failed to refresh track suggestions',
          searchDetails: result.searchDetails as {
            attempts: number
            totalTracksFound: number
            excludedTrackIds: string[]
            minPopularity: number
            genresTried: string[]
            trackDetails: Array<{
              name: string
              popularity: number
              isExcluded: boolean
              isPlayable: boolean
              duration_ms: number
              explicit: boolean
            }>
          },
          diagnosticInfo: {
            playlistLength: allPlaylistTracks.length,
            upcomingTracksCount: upcomingTracks.length,
            currentTrackId,
            genresUsed: params.genres,
            timestamp: new Date().toISOString()
          }
        }
      }

      return {
        success: true,
        message: 'Track suggestions refreshed successfully',
        searchDetails: result.searchDetails as {
          attempts: number
          totalTracksFound: number
          excludedTrackIds: string[]
          minPopularity: number
          genresTried: string[]
          trackDetails: Array<{
            name: string
            popularity: number
            isExcluded: boolean
            isPlayable: boolean
            duration_ms: number
            explicit: boolean
          }>
        },
        diagnosticInfo: {
          playlistLength: allPlaylistTracks.length,
          upcomingTracksCount: upcomingTracks.length,
          currentTrackId,
          genresUsed: params.genres,
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      console.error(
        '[PlaylistRefresh] Error in refreshTrackSuggestions:',
        error
      )
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Unknown error occurred'
      }
    } finally {
      this.isRefreshing = false
    }
  }
}
