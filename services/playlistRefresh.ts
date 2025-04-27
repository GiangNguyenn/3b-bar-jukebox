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
    genres: string[]
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
  private readonly retryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000
  }
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
    genres: string[]
  } | null = null
  private isRefreshing = false
  private readonly TIMEOUT_MS = 45000 // 45 seconds timeout
  private lastSnapshotId: string | null = null

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

  private async getFixedPlaylist(): Promise<{ playlist: SpotifyPlaylistItem | null; snapshotId: string | null }> {
    const playlists = await this.spotifyApi.getPlaylists()
    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === this.FIXED_PLAYLIST_NAME
    )

    if (!fixedPlaylist) {
      return { playlist: null, snapshotId: null }
    }

    const playlist = await this.spotifyApi.getPlaylist(fixedPlaylist.id)
    return { playlist, snapshotId: playlist.snapshot_id }
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
      if (error instanceof Error) {
        console.error('Error adding track to playlist:', {
          error: error.message,
          trackUri,
          playlistId,
          timestamp: new Date().toISOString()
        })
      }
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
    // Check if we've reached the maximum number of upcoming tracks
    if (upcomingTracks.length >= MAX_PLAYLIST_LENGTH) {
      console.log('[PlaylistRefresh] Playlist has reached maximum length:', {
        currentLength: upcomingTracks.length,
        maxLength: MAX_PLAYLIST_LENGTH,
        timestamp: new Date().toISOString()
      })
      return {
        success: false,
        error: 'Playlist too long'
      }
    }

    const existingTrackIds = Array.from(
      new Set(allPlaylistTracks.map((track) => track.track.id))
    )

    try {
      let retryCount = 0
      let success = false
      let searchDetails: unknown

      while (!success && retryCount < this.retryConfig.maxRetries) {
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
          console.log(
            '[PlaylistRefresh] Setting last suggested track:',
            result.track
          )
          this.lastSuggestedTrack = {
            name: result.track.name,
            artist: result.track.artists[0].name,
            album: result.track.album.name,
            uri: result.track.uri,
            popularity: result.track.popularity,
            duration_ms: result.track.duration_ms,
            preview_url: result.track.preview_url ?? null,
            genres: [
              result.searchDetails.genresTried[
                result.searchDetails.genresTried.length - 1
              ]
            ]
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
              },
              retryConfig: this.retryConfig
            })
          }
        } else {
          retryCount++
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              this.retryConfig.baseDelay * Math.pow(2, retryCount)
            )
          )
        }
      }

      return {
        success,
        error: !success
          ? 'Failed to add track after multiple attempts'
          : undefined,
        searchDetails
      }
    } catch (error) {
      console.error('Error in addSuggestedTrackToPlaylist:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        playlistId,
        currentTrackId,
        timestamp: new Date().toISOString()
      })
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        searchDetails: undefined
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

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Operation timed out'))
      }, timeoutMs)
    })

    return Promise.race([promise, timeoutPromise])
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
    if (this.isRefreshing) {
      return {
        success: false,
        message: 'Refresh operation already in progress',
        timestamp: new Date().toISOString()
      }
    }

    try {
      this.isRefreshing = true

      const { playlist, snapshotId } = await this.withTimeout(
        this.getFixedPlaylist(),
        this.TIMEOUT_MS
      )

      if (!playlist) {
        console.error('[PlaylistRefresh] No playlist found:', {
          playlistName: this.FIXED_PLAYLIST_NAME,
          timestamp: new Date().toISOString()
        })
        return {
          success: false,
          message: `No playlist found with name: ${this.FIXED_PLAYLIST_NAME}`,
          timestamp: new Date().toISOString()
        }
      }

      // Check if the snapshot_id has changed
      const hasPlaylistChanged = this.lastSnapshotId !== snapshotId
      console.log('[PlaylistRefresh] Snapshot ID comparison:', {
        lastSnapshotId: this.lastSnapshotId,
        currentSnapshotId: snapshotId,
        hasPlaylistChanged,
        timestamp: new Date().toISOString()
      })

      // Update the lastSnapshotId
      this.lastSnapshotId = snapshotId

      const { id: currentTrackId, error: playbackError } =
        await this.withTimeout(this.getCurrentlyPlaying(), this.TIMEOUT_MS)

      if (playbackError) {
        console.error('[PlaylistRefresh] Playback error:', {
          error: playbackError,
          timestamp: new Date().toISOString()
        })
        return {
          success: false,
          message: playbackError,
          timestamp: new Date().toISOString()
        }
      }

      const upcomingTracks = this.getUpcomingTracks(playlist, currentTrackId)

      const playbackState = await this.withTimeout(
        this.spotifyApi.getPlaybackState(),
        this.TIMEOUT_MS
      )

      const removedTrack = await this.withTimeout(
        this.autoRemoveFinishedTrack({
          playlistId: playlist.id,
          currentTrackId,
          playlistTracks: playlist.tracks.items,
          playbackState
        }),
        this.TIMEOUT_MS
      )

      // Resume playback if the playlist has changed
      if (hasPlaylistChanged && playbackState?.context?.uri && playbackState?.item?.uri) {
        try {
          await this.withTimeout(
            sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: playbackState.context.uri,
                offset: { uri: playbackState.item.uri },
                position_ms: playbackState.progress_ms ?? 0
              },
              retryConfig: this.retryConfig
            }),
            this.TIMEOUT_MS
          )
        } catch (error) {
          console.error('[PlaylistRefresh] Failed to resume playback:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          })
        }
      }

      const diagnosticInfo = {
        currentTrackId,
        totalTracks: playlist.tracks.items.length,
        upcomingTracksCount: upcomingTracks.length,
        playlistTrackIds: playlist.tracks.items.map((t) => t.track.id),
        upcomingTrackIds: upcomingTracks.map((t) => t.track.id),
        removedTrack,
        addedTrack: false
      }

      const result = await this.withTimeout(
        this.addSuggestedTrackToPlaylist(
          upcomingTracks,
          playlist.id,
          currentTrackId,
          playlist.tracks.items,
          params
        ),
        this.TIMEOUT_MS
      )

      if (!result.success) {
        console.error('[PlaylistRefresh] Failed to add track:', {
          error: result.error,
          diagnosticInfo,
          timestamp: new Date().toISOString()
        })
        return {
          success: false,
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
        forceRefresh: force,
        playerStateRefresh: true
      }
    } catch (error) {
      console.error('[PlaylistRefresh] Error in refreshPlaylist:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      })
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to refresh playlist',
        timestamp: new Date().toISOString()
      }
    } finally {
      this.isRefreshing = false
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
    genres: string[]
  } | null {
    console.log(
      '[PlaylistRefresh] Getting last suggested track:',
      this.lastSuggestedTrack
    )
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
    if (this.isRefreshing) {
      return {
        success: false,
        message: 'Refresh operation already in progress'
      }
    }

    try {
      this.isRefreshing = true

      const { playlist } = await this.getFixedPlaylist()
      if (!playlist) {
        return {
          success: false,
          message: `No playlist found with name: ${this.FIXED_PLAYLIST_NAME}`
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
