import {
  SpotifyPlaylistItem,
  TrackItem,
  SpotifyPlaybackState
} from '@/shared/types'
import { SpotifyApiClient, SpotifyApiService } from './spotifyApi'
import {
  MAX_PLAYLIST_LENGTH,
  FALLBACK_GENRES
} from '@/shared/constants/trackSuggestion'
import { findSuggestedTrack, Genre } from '@/services/trackSuggestion'
import { filterUpcomingTracks } from '@/lib/utils'
import { autoRemoveTrack } from '@/shared/utils/autoRemoveTrack'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { DEFAULT_MARKET } from '@/shared/constants/trackSuggestion'
import { sendApiRequest } from '@/shared/api'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

const LAST_SUGGESTED_TRACK_KEY = 'last-suggested-track'

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
    songsBetweenRepeats: number
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
    this.loadLastSuggestedTrack()
  }

  private loadLastSuggestedTrack(): void {
    try {
      if (typeof window !== 'undefined') {
        const savedTrack = localStorage.getItem(LAST_SUGGESTED_TRACK_KEY)
        if (savedTrack) {
          this.lastSuggestedTrack = JSON.parse(savedTrack)
        }
      }
    } catch (error) {
      console.error(
        '[PlaylistRefresh] Error loading last suggested track:',
        error
      )
    }
  }

  private saveLastSuggestedTrack(): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          LAST_SUGGESTED_TRACK_KEY,
          JSON.stringify(this.lastSuggestedTrack)
        )
      }
    } catch (error) {
      console.error(
        '[PlaylistRefresh] Error saving last suggested track:',
        error
      )
    }
  }

  public static getInstance(): PlaylistRefreshServiceImpl {
    if (!PlaylistRefreshServiceImpl.instance) {
      PlaylistRefreshServiceImpl.instance = new PlaylistRefreshServiceImpl()
    } else {
      // Ensure the track is loaded from localStorage
      if (typeof window !== 'undefined') {
        try {
          const savedTrack = localStorage.getItem(LAST_SUGGESTED_TRACK_KEY)
          if (savedTrack) {
            PlaylistRefreshServiceImpl.instance.lastSuggestedTrack =
              JSON.parse(savedTrack)
          }
        } catch (error) {
          console.error(
            '[PlaylistRefresh] Error loading from localStorage in getInstance:',
            error
          )
        }
      }
    }
    return PlaylistRefreshServiceImpl.instance
  }

  // For testing purposes only
  public static resetInstance(): void {
    PlaylistRefreshServiceImpl.instance = undefined as any
  }

  private async getFixedPlaylist(): Promise<{
    playlist: SpotifyPlaylistItem | null
    snapshotId: string | null
  }> {
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
    // Find the current track's position in the playlist
    const currentTrackIndex = currentTrackId
      ? allPlaylistTracks.findIndex(
          (track) => track.track.id === currentTrackId
        )
      : -1

    // Calculate how many tracks are left after the current track
    const tracksRemaining =
      currentTrackIndex >= 0
        ? allPlaylistTracks.length - (currentTrackIndex + 1)
        : allPlaylistTracks.length

    // Check if we have 3 or fewer tracks remaining
    if (tracksRemaining > 3) {
      console.log(
        '[PlaylistRefresh] Enough tracks remaining, skipping suggestion:',
        {
          tracksRemaining,
          currentTrackIndex,
          totalTracks: allPlaylistTracks.length,
          currentTrackId,
          timestamp: new Date().toISOString()
        }
      )
      return {
        success: false,
        error: 'Enough tracks remaining'
      }
    }

    // Log the upcoming tracks for debugging
    console.log('[PlaylistRefresh] Upcoming tracks:', {
      count: upcomingTracks.length,
      tracksRemaining,
      currentTrackIndex,
      totalTracks: allPlaylistTracks.length,
      tracks: upcomingTracks.map((track) => ({
        id: track.track.id,
        name: track.track.name,
        position: allPlaylistTracks.findIndex(
          (t) => t.track.id === track.track.id
        )
      })),
      currentTrackId,
      timestamp: new Date().toISOString()
    })

    const existingTrackIds = Array.from(
      new Set(allPlaylistTracks.map((track) => track.track.id))
    )

    try {
      let retryCount = 0
      let success = false
      let searchDetails: unknown

      // Get parameters from localStorage or use defaults
      const savedState =
        typeof window !== 'undefined'
          ? localStorage.getItem('track-suggestions-state')
          : null
      const savedParams = savedState
        ? (JSON.parse(savedState) as TrackSuggestionsState)
        : null

      const defaultParams = {
        genres: Array.from(FALLBACK_GENRES) as Genre[],
        yearRange: [1950, new Date().getFullYear()] as [number, number],
        popularity: 50,
        allowExplicit: false,
        maxSongLength: 300,
        songsBetweenRepeats: 5
      }

      // Merge provided params with saved params or defaults
      const mergedParams = {
        ...defaultParams,
        ...(savedParams || {}),
        ...params
      }

      console.log('[PlaylistRefresh] Using parameters:', {
        savedParams,
        providedParams: params,
        mergedParams
      })

      while (!success && retryCount < this.retryConfig.maxRetries) {
        console.log(
          '[PARAM CHAIN] Passing genres to findSuggestedTrack (playlistRefresh.ts):',
          mergedParams.genres
        )
        const result = await findSuggestedTrack(
          existingTrackIds,
          currentTrackId,
          DEFAULT_MARKET,
          mergedParams
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
            '[PlaylistRefresh] Successfully added track, preparing to save:',
            {
              name: result.track.name,
              artist: result.track.artists[0].name,
              timestamp: new Date().toISOString()
            }
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

          // Save to localStorage if in browser
          if (typeof window !== 'undefined') {
            console.log(
              '[PlaylistRefresh] About to save track to localStorage:',
              {
                name: this.lastSuggestedTrack.name,
                artist: this.lastSuggestedTrack.artist,
                timestamp: new Date().toISOString()
              }
            )
            this.saveLastSuggestedTrack()
          }

          // Update server cache via POST request
          try {
            const response = await fetch(
              '/api/track-suggestions/last-suggested',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.lastSuggestedTrack)
              }
            )
            if (!response.ok) {
              throw new Error('Failed to update server cache')
            }
            console.log('[PlaylistRefresh] Successfully updated server cache')
          } catch (error) {
            console.error(
              '[PlaylistRefresh] Error updating server cache:',
              error
            )
          }

          // Get current playback state to resume at the same position
          const playbackState = await this.spotifyApi.getPlaybackState()
          if (playbackState?.context?.uri && playbackState?.item?.uri) {
            // Resume playback at the exact same track and position
            await sendApiRequest({
              path: `me/player/play?device_id=${playbackState.device.id}`,
              method: 'PUT',
              body: {
                context_uri: playbackState.context.uri,
                offset: { uri: playbackState.item.uri },
                position_ms: playbackState.progress_ms ?? 0
              },
              retryConfig: this.retryConfig,
              debounceTime: 60000 // 1 minute debounce
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
    songsBetweenRepeats: number
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
          playbackState,
          songsBetweenRepeats: params?.songsBetweenRepeats || 5
        }),
        this.TIMEOUT_MS
      )

      // Resume playback if the playlist has changed
      if (
        hasPlaylistChanged &&
        playbackState?.context?.uri &&
        playbackState?.item?.uri
      ) {
        try {
          await this.withTimeout(
            this.spotifyApi.resumePlaybackAtPosition({
              deviceId: playbackState.device.id,
              contextUri: playbackState.context.uri,
              trackUri: playbackState.item.uri,
              position: playbackState.progress_ms ?? 0
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
    // If we don't have a track in memory, try to load from localStorage
    if (!this.lastSuggestedTrack && typeof window !== 'undefined') {
      try {
        const savedTrack = localStorage.getItem(LAST_SUGGESTED_TRACK_KEY)
        if (savedTrack) {
          this.lastSuggestedTrack = JSON.parse(savedTrack)
        }
      } catch (error) {
        console.error(
          '[PlaylistRefresh] Error loading from localStorage in getLastSuggestedTrack:',
          error
        )
      }
    }

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

      // Add track removal step
      const playbackState = await this.spotifyApi.getPlaybackState()
      const removedTrack = await this.autoRemoveFinishedTrack({
        playlistId: playlist.id,
        currentTrackId,
        playlistTracks: allPlaylistTracks,
        playbackState,
        songsBetweenRepeats: params.songsBetweenRepeats
      })

      console.log('[PlaylistRefresh] Track removal result:', {
        removedTrack,
        currentTrackId,
        timestamp: new Date().toISOString()
      })

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
