import {
  SpotifyPlaylistItem,
  SpotifyPlaybackState,
  SpotifyPlayerQueue,
  TrackItem
} from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { showToast } from '@/lib/toast'
import { spotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { transferPlaybackToDevice } from '@/services/deviceManagement/deviceTransfer'

// Add logging context
let addLog: (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

// Function to set the logging function
export function setSpotifyApiLogger(logger: typeof addLog) {
  addLog = logger
}

export interface SpotifyApiClient {
  getPlaylists(): Promise<{ items: SpotifyPlaylistItem[] }>
  getPlaylist(playlistId: string): Promise<SpotifyPlaylistItem>
  getCurrentlyPlaying(): Promise<SpotifyPlaybackState>
  addTrackToPlaylist(playlistId: string, trackUri: string): Promise<void>
  getPlaybackState(): Promise<SpotifyPlaybackState>
  resumePlayback(
    position_ms?: number,
    deviceId?: string
  ): Promise<{
    success: boolean
    resumedFrom?: {
      trackUri: string
      position: number
    }
  }>
  pausePlayback(deviceId: string): Promise<{ success: boolean }>
  addItemsToPlaylist(playlistId: string, trackUris: string[]): Promise<void>
  addTrackToQueue(trackUri: string): Promise<void>
  getCurrentQueue(): Promise<SpotifyPlayerQueue>
  seekToPosition(position_ms: number, deviceId?: string): Promise<void>
}

export class SpotifyApiService implements SpotifyApiClient {
  private static instance: SpotifyApiService
  private readonly retryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000
  }

  private constructor(private readonly apiClient = sendApiRequest) {
    // Simplified constructor - no need for complex caching
  }

  public static getInstance(): SpotifyApiService {
    if (!SpotifyApiService.instance) {
      SpotifyApiService.instance = new SpotifyApiService()
    }
    return SpotifyApiService.instance
  }

  async getPlaylists(): Promise<{ items: SpotifyPlaylistItem[] }> {
    return handleOperationError(
      async () =>
        this.apiClient<{ items: SpotifyPlaylistItem[] }>({
          path: 'me/playlists',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.getPlaylists'
    )
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylistItem> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlaylistItem>({
          path: `playlists/${playlistId}`,
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.getPlaylist'
    )
  }

  async getCurrentlyPlaying(): Promise<SpotifyPlaybackState> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlaybackState>({
          path: 'me/player/currently-playing?market=from_token',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.getCurrentlyPlaying'
    )
  }

  async addTrackToPlaylist(
    playlistId: string,
    trackUri: string
  ): Promise<void> {
    const formattedUri = trackUri.startsWith('spotify:track:')
      ? trackUri
      : `spotify:track:${trackUri}`

    return handleOperationError(
      async () =>
        this.apiClient({
          path: `playlists/${playlistId}/tracks`,
          method: 'POST',
          body: {
            uris: [formattedUri]
          },
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.addTrackToPlaylist'
    )
  }

  async addItemsToPlaylist(
    playlistId: string,
    trackUris: string[]
  ): Promise<void> {
    const formattedUris = trackUris.map((uri) =>
      uri.startsWith('spotify:track:') ? uri : `spotify:track:${uri}`
    )

    return handleOperationError(
      async () =>
        this.apiClient({
          path: `playlists/${playlistId}/tracks`,
          method: 'POST',
          body: {
            uris: formattedUris
          },
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.addItemsToPlaylist'
    )
  }

  async getPlaybackState(): Promise<SpotifyPlaybackState> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlaybackState>({
          path: 'me/player?market=from_token',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.getPlaybackState'
    )
  }

  async resumePlayback(
    position_ms?: number,
    targetDeviceId?: string
  ): Promise<{
    success: boolean
    resumedFrom?: {
      trackUri: string
      position: number
    }
  }> {
    return handleOperationError(async () => {
      try {
        // Always use the app's device ID - never fallback to other devices.
        // ResumePlayback is now responsible only for resuming the current
        // Spotify context on the app's device, not for selecting the next
        // track from the jukebox queue. Track-to-track transitions are
        // handled by playerLifecycleService via SDK events.
        let deviceId = targetDeviceId
        if (!deviceId) {
          const appDeviceId = spotifyPlayerStore.getState().deviceId
          deviceId = appDeviceId ?? undefined
          if (!deviceId) {
            throw new Error(
              'App device ID is not available. Please ensure the Spotify player is initialized.'
            )
          }
        }

        // Ensure playback is routed to the app device before resuming.
        const transferred = await transferPlaybackToDevice(deviceId)
        if (!transferred) {
          throw new Error(
            `Failed to transfer playback to app device: ${deviceId}`
          )
        }

        // Resume the current Spotify context on the app device. We do not
        // pass URIs here so that Spotify continues from the existing
        // context (current track/queue). Position is optional.
        const body =
          typeof position_ms === 'number' ? { position_ms } : undefined

        await this.apiClient({
          path: `me/player/play?device_id=${deviceId}`,
          method: 'PUT',
          body,
          retryConfig: this.retryConfig
        })

        showToast('Playback resumed', 'success')
        return {
          success: true,
          resumedFrom:
            typeof position_ms === 'number'
              ? {
                  trackUri: '',
                  position: position_ms
                }
              : undefined
        }
      } catch (error) {
        if (addLog) {
          addLog(
            'ERROR',
            'Error in resumePlayback',
            'SpotifyApi',
            error instanceof Error ? error : undefined
          )
        } else {
          console.error('[SpotifyApi] Error in resumePlayback:', error)
        }
        throw error
      }
    }, 'SpotifyApi.resumePlayback')
  }

  private async ensureAppDevice(): Promise<string> {
    try {
      // Only use the app's device ID from the store - never fallback to other devices
      const appDeviceId = spotifyPlayerStore.getState().deviceId

      if (!appDeviceId) {
        throw new Error(
          'App device ID is not available. Please ensure the Spotify player is initialized.'
        )
      }

      // Transfer playback to the app's device
      const transferred = await transferPlaybackToDevice(appDeviceId)
      if (!transferred) {
        throw new Error(
          `Failed to transfer playback to app device: ${appDeviceId}`
        )
      }

      return appDeviceId
    } catch (error) {
      if (addLog) {
        addLog(
          'ERROR',
          'Error ensuring app device',
          'SpotifyApi',
          error instanceof Error ? error : undefined
        )
      } else {
        console.error('[SpotifyApi] Error ensuring app device:', error)
      }
      throw error
    }
  }

  async pausePlayback(deviceId: string): Promise<{ success: boolean }> {
    return handleOperationError(async () => {
      try {
        await this.apiClient({
          path: `me/player/pause?device_id=${deviceId}`,
          method: 'PUT',
          retryConfig: this.retryConfig
        })

        return { success: true }
      } catch (error) {
        if (addLog) {
          addLog(
            'ERROR',
            'Error in pausePlayback',
            'SpotifyApi',
            error instanceof Error ? error : undefined
          )
        } else {
          console.error('[SpotifyApi] Error in pausePlayback:', error)
        }
        throw error
      }
    }, 'SpotifyApi.pausePlayback')
  }

  async addTrackToQueue(trackUri: string): Promise<void> {
    const formattedUri = trackUri.startsWith('spotify:track:')
      ? trackUri
      : `spotify:track:${trackUri}`

    return handleOperationError(
      async () =>
        this.apiClient({
          path: `me/player/queue?uri=${encodeURIComponent(formattedUri)}`,
          method: 'POST',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.addTrackToQueue'
    )
  }

  async getCurrentQueue(): Promise<SpotifyPlayerQueue> {
    return handleOperationError(
      async () =>
        this.apiClient<SpotifyPlayerQueue>({
          path: 'me/player/queue',
          method: 'GET',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.getCurrentQueue'
    )
  }

  async seekToPosition(position_ms: number, deviceId?: string): Promise<void> {
    // Always require the app's device ID - never fallback
    const appDeviceId = deviceId || spotifyPlayerStore.getState().deviceId

    if (!appDeviceId) {
      throw new Error(
        'App device ID is not available. Please ensure the Spotify player is initialized.'
      )
    }

    return handleOperationError(
      async () =>
        this.apiClient({
          path: `me/player/seek?position_ms=${position_ms}&device_id=${appDeviceId}`,
          method: 'PUT',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.seekToPosition'
    )
  }
}
