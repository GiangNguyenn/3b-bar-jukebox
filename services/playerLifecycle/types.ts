import type { SpotifyPlaybackState } from '@/shared/types/spotify'

export interface PlayerEventDispatcher {
  handleDeviceReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): Promise<void>
  handleDeviceInitializationFailure(
    error: unknown,
    onStatusChange: (status: string, error?: string) => void
  ): void
  handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ): void
  handleInitializationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void
  ): void
  handleAuthenticationError(
    message: string,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void>
  handleAccountError(message: string): void
  handlePlaybackError(message: string): void
  handlePlayerStateChangeEvent(
    state: unknown,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void,
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void
  ): void
}

export interface StateProcessorInterface {
  processStateChange(
    state: PlayerSDKState,
    onPlaybackStateChange: (state: SpotifyPlaybackState | null) => void
  ): Promise<void>
}

export interface PlayerSDKState {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: {
      id: string
      uri: string
      name: string
      artists: Array<{ name: string }>
      album: {
        name: string
        images: Array<{ url: string }>
      }
      duration_ms: number
    } | null
  }
}

// Type guard for runtime validation of PlayerSDKState
export function isPlayerSDKState(state: unknown): state is PlayerSDKState {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  const paused = s.paused
  const position = s.position
  const duration = s.duration
  const trackWindow = s.track_window

  // Validate base properties
  if (
    typeof paused !== 'boolean' ||
    typeof position !== 'number' ||
    typeof duration !== 'number' ||
    !trackWindow ||
    typeof trackWindow !== 'object' ||
    !('current_track' in trackWindow)
  ) {
    return false
  }

  // Issue #11: Validate current_track structure if present
  const currentTrack = (trackWindow as Record<string, unknown>).current_track
  if (currentTrack !== null) {
    if (
      typeof currentTrack !== 'object' ||
      !('id' in currentTrack) ||
      !('uri' in currentTrack) ||
      !('name' in currentTrack)
    ) {
      return false
    }
  }

  return true
}
