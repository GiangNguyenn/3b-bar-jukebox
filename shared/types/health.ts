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
  // Optional recovery fields for components that need them
  recovery?: 'idle' | 'recovering' | 'completed' | 'failed'
  recoveryMessage?: string
  recoveryProgress?: number
  recoveryCurrentStep?: string
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
