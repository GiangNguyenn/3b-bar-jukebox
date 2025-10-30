import {
  SpotifyPlaylistItem,
  SpotifyPlaybackState,
  TrackItem
} from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { showToast } from '@/lib/toast'
import { queueManager } from '@/services/queueManager'

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
        // Ensure we are on the intended device if provided; otherwise pick an active device
        let deviceId = targetDeviceId
        if (!deviceId) {
          deviceId = await this.ensureActiveDevice()
        } else {
          // Transfer playback to the specific device without auto-play
          await this.apiClient({
            path: 'me/player',
            method: 'PUT',
            body: { device_ids: [deviceId], play: false },
            retryConfig: this.retryConfig
          })
          await new Promise((resolve) => setTimeout(resolve, 800))
        }

        // Get the next track from our database queue
        const nextTrack = queueManager.getNextTrack()

        if (nextTrack) {
          const trackUri = `spotify:track:${nextTrack.tracks.spotify_track_id}`

          try {
            // Play the next track from our database queue
            await this.apiClient({
              path: `me/player/play?device_id=${deviceId}`,
              method: 'PUT',
              body: {
                uris: [trackUri],
                position_ms: position_ms
              },
              retryConfig: this.retryConfig
            })

            showToast('Playback resumed', 'success')
            return {
              success: true,
              resumedFrom: {
                trackUri: trackUri,
                position: position_ms || 0
              }
            }
          } catch (error) {
            // Handle "Restriction violated" errors by removing the problematic track and trying the next one
            if (
              error instanceof Error &&
              error.message.includes('Restriction violated')
            ) {
              if (addLog) {
                addLog(
                  'WARN',
                  `Restriction violated for track: ${nextTrack.tracks.name} (ID: ${nextTrack.id})`,
                  'SpotifyApi'
                )
              }

              // Remove the problematic track from the queue
              await queueManager.markAsPlayed(nextTrack.id)

              // Try to get the next track and play it
              const nextNextTrack = queueManager.getNextTrack()
              if (nextNextTrack) {
                // Recursively call resumePlayback to try the next track
                return this.resumePlayback()
              } else {
                if (addLog) {
                  addLog(
                    'WARN',
                    'No more tracks available after removing problematic track',
                    'SpotifyApi'
                  )
                }
                showToast('No tracks available', 'info')
                return { success: true }
              }
            } else {
              // Re-throw other errors
              throw error
            }
          }
        } else {
          if (addLog) {
            addLog(
              'WARN',
              'No tracks available in database queue for resume',
              'SpotifyApi'
            )
          }

          // If no tracks in queue, just ensure device is active
          showToast('No tracks in queue', 'info')
          return {
            success: true
          }
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

  private async ensureActiveDevice(): Promise<string> {
    try {
      const currentState = await this.getPlaybackState()

      // If we already have an active device, return its ID
      if (currentState?.device?.id) {
        return currentState.device.id
      }

      // Get available devices
      const devices = await this.apiClient<{
        devices: Array<{ id: string; is_active: boolean }>
      }>({
        path: 'me/player/devices',
        retryConfig: this.retryConfig
      })

      // Find an active device or use the first available one
      const activeDevice =
        devices.devices.find((device) => device.is_active) || devices.devices[0]

      if (!activeDevice) {
        throw new Error('No available devices found')
      }

      // Transfer playback to the selected device
      await this.apiClient({
        path: 'me/player',
        method: 'PUT',
        body: {
          device_ids: [activeDevice.id],
          play: false
        },
        retryConfig: this.retryConfig
      })

      // Wait a moment for the device to become active
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify the device is now active
      const newState = await this.getPlaybackState()
      if (newState?.device?.id !== activeDevice.id) {
        throw new Error('Failed to activate device')
      }

      return activeDevice.id
    } catch (error) {
      if (addLog) {
        addLog(
          'ERROR',
          'Error ensuring active device',
          'SpotifyApi',
          error instanceof Error ? error : undefined
        )
      } else {
        console.error('[SpotifyApi] Error ensuring active device:', error)
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
}
