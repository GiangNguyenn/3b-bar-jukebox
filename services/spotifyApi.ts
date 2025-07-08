import {
  SpotifyPlaylistItem,
  SpotifyPlaybackState,
  TrackItem
} from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { showToast } from '@/lib/toast'

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
  getQueue(): Promise<{ queue: SpotifyPlaybackState[] }>
  resumePlayback(): Promise<{
    success: boolean
    resumedFrom?: {
      trackUri: string
      position: number
    }
  }>
  pausePlayback(deviceId: string): Promise<{
    success: boolean
  }>
  addItemsToPlaylist(playlistId: string, trackUris: string[]): Promise<void>
}

export class SpotifyApiService implements SpotifyApiClient {
  private static instance: SpotifyApiService
  private readonly retryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000
  }
  private fixedPlaylistCache: {
    id: string
    timestamp: number
  } | null = null
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  private lastKnownPlayback: {
    trackUri: string
    position: number
    timestamp: number
  } | null = null
  private readonly PLAYBACK_CACHE_KEY = 'spotify_last_playback'

  private constructor(private readonly apiClient = sendApiRequest) {
    // Load last known playback from localStorage on initialization
    try {
      const cached = localStorage.getItem(this.PLAYBACK_CACHE_KEY)
      if (cached) {
        this.lastKnownPlayback = JSON.parse(cached)
      }
    } catch (error) {
      if (addLog) {
        addLog(
          'ERROR',
          'Error loading cached playback state',
          'SpotifyApi',
          error instanceof Error ? error : undefined
        )
      } else {
        console.error(
          '[SpotifyApi] Error loading cached playback state:',
          error
        )
      }
    }
  }

  private saveLastKnownPlayback(trackUri: string, position: number): void {
    this.lastKnownPlayback = {
      trackUri,
      position,
      timestamp: Date.now()
    }
    try {
      localStorage.setItem(
        this.PLAYBACK_CACHE_KEY,
        JSON.stringify(this.lastKnownPlayback)
      )
    } catch (error) {
      if (addLog) {
        addLog(
          'ERROR',
          'Error saving playback state',
          'SpotifyApi',
          error instanceof Error ? error : undefined
        )
      } else {
        console.error('[SpotifyApi] Error saving playback state:', error)
      }
    }
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

  async getQueue(): Promise<{ queue: SpotifyPlaybackState[] }> {
    return handleOperationError(
      async () =>
        this.apiClient<{ queue: SpotifyPlaybackState[] }>({
          path: 'me/player/queue?market=from_token',
          retryConfig: this.retryConfig
        }),
      'SpotifyApi.getQueue'
    )
  }

  private async resumePlaybackAtPosition(params: {
    deviceId: string
    contextUri: string
    trackUri?: string
    position: number
  }): Promise<{
    success: boolean
    resumedFrom?: {
      trackUri: string
      position: number
    }
  }> {
    return handleOperationError(async () => {
      const { deviceId, contextUri, trackUri, position } = params

      // Get current playback state to ensure we have the latest state
      const currentState = await this.getPlaybackState()

      // Start playback with the provided context and position
      await this.apiClient({
        path: `me/player/play?device_id=${deviceId}`,
        method: 'PUT',
        body: {
          context_uri: contextUri,
          position_ms: position,
          ...(trackUri ? { offset: { uri: trackUri } } : {})
        },
        retryConfig: this.retryConfig,
        debounceTime: 60000 // 1 minute debounce
      })

      return {
        success: true,
        resumedFrom: trackUri
          ? {
              trackUri,
              position
            }
          : undefined
      }
    }, 'SpotifyApi.resumePlaybackAtPosition')
  }

  private async getFixedPlaylistId(): Promise<string> {
    // Check if we have a valid cached playlist ID
    if (
      this.fixedPlaylistCache &&
      Date.now() - this.fixedPlaylistCache.timestamp < this.CACHE_TTL
    ) {
      return this.fixedPlaylistCache.id
    }

    // If no valid cache, fetch from API
    const playlists = await this.getPlaylists()
    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === '3B Saigon'
    )

    if (!fixedPlaylist) {
      throw new Error('No fixed playlist available')
    }

    // Update cache
    this.fixedPlaylistCache = {
      id: fixedPlaylist.id,
      timestamp: Date.now()
    }

    return fixedPlaylist.id
  }

  async resumePlayback(): Promise<{
    success: boolean
    resumedFrom?: {
      trackUri: string
      position: number
    }
  }> {
    return handleOperationError(async () => {
      try {
        // First ensure we have an active device
        const deviceId = await this.ensureActiveDevice()

        // Get the fixed playlist ID - we'll need this in all cases
        const fixedPlaylistId = await this.getFixedPlaylistId()
        const fixedPlaylistUri = `spotify:playlist:${fixedPlaylistId}`

        // Get current state after ensuring device
        const currentState = await this.getPlaybackState()

        // If we have a current state with context and item, try to resume from there
        if (currentState?.context?.uri && currentState?.item?.uri) {
          try {
            // Save current state before attempting to resume
            this.saveLastKnownPlayback(
              currentState.item.uri,
              currentState.progress_ms || 0
            )

            // Try to resume from current position
            await this.apiClient({
              path: `me/player/play?device_id=${deviceId}`,
              method: 'PUT',
              body: {
                context_uri: currentState.context.uri,
                position_ms: currentState.progress_ms || 0,
                offset: { uri: currentState.item.uri }
              },
              retryConfig: this.retryConfig
            })

            showToast('Playback resumed', 'success')
            return {
              success: true,
              resumedFrom: {
                trackUri: currentState.item.uri,
                position: currentState.progress_ms || 0
              }
            }
          } catch (error) {
            if (addLog) {
              addLog(
                'WARN',
                'Failed to resume from current state',
                'SpotifyApi',
                error instanceof Error ? error : undefined
              )
            } else {
              console.warn(
                '[SpotifyApi] Failed to resume from current state:',
                error
              )
            }
            // Fall through to starting with fixed playlist
          }
        }

        // If we have last known playback and it's recent (within last hour), try to resume from there
        if (
          this.lastKnownPlayback &&
          Date.now() - this.lastKnownPlayback.timestamp < 3600000
        ) {
          try {
            await this.apiClient({
              path: `me/player/play?device_id=${deviceId}`,
              method: 'PUT',
              body: {
                context_uri: fixedPlaylistUri,
                offset: { uri: this.lastKnownPlayback.trackUri },
                position_ms: this.lastKnownPlayback.position
              },
              retryConfig: this.retryConfig
            })

            showToast('Playback resumed', 'success')
            return {
              success: true,
              resumedFrom: {
                trackUri: this.lastKnownPlayback.trackUri,
                position: this.lastKnownPlayback.position
              }
            }
          } catch (error) {
            if (addLog) {
              addLog(
                'WARN',
                'Failed to resume from last known position',
                'SpotifyApi',
                error instanceof Error ? error : undefined
              )
            } else {
              console.warn(
                '[SpotifyApi] Failed to resume from last known position:',
                error
              )
            }
            // Fall through to starting fresh
          }
        }

        // If all else fails, start fresh with the fixed playlist
        await this.apiClient({
          path: `me/player/play?device_id=${deviceId}`,
          method: 'PUT',
          body: {
            context_uri: fixedPlaylistUri
          },
          retryConfig: this.retryConfig
        })

        // Wait a moment for playback to start
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Verify playback started
        const verifyState = await this.getPlaybackState()
        if (!verifyState?.is_playing) {
          throw new Error('Playback failed to start')
        }

        showToast('Playback resumed', 'success')
        return {
          success: true
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
