/**
 * Shared types for player services
 */

import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

// Player status states
export type PlayerStatus =
  | 'uninitialized'
  | 'initializing'
  | 'verifying'
  | 'ready'
  | 'error'
  | 'recovering'

// Logger function type
export type Logger = (
  level: LogLevel,
  message: string,
  context?: string,
  error?: Error
) => void

// Callback types for player lifecycle events
export type StatusChangeCallback = (status: string, error?: string) => void
export type DeviceIdCallback = (deviceId: string) => void
export type PlaybackStateCallback = (state: SpotifyPlaybackState) => void

// Internal SDK state tracking
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

// Player configuration
export interface PlayerConfig {
  name: string
  volume?: number
}

// Unsubscribe function type
export type Unsubscribe = () => void
