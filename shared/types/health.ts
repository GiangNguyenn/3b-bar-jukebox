export interface HealthStatus {
  deviceId: string | null
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown' | 'error'
  playback: 'playing' | 'paused' | 'stopped' | 'error' | 'unknown' | 'stalled'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  tokenExpiringSoon: boolean
  connection:
    | 'connected'
    | 'disconnected'
    | 'good'
    | 'poor'
    | 'unstable'
    | 'unknown'
}

// Additional health-related types
export interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
}

export type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'
  | 'error'
