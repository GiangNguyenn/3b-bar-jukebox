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
  // Diagnostic fields
  lastError?: string
  lastErrorTimestamp?: number
  recentEvents?: DiagnosticEvent[]
  playbackDetails?: PlaybackDetails
  queueState?: QueueState
  failureMetrics?: FailureMetrics
  systemInfo?: SystemInfo
}

// System information for diagnostics
export interface SystemInfo {
  userAgent: string
  platform: string
  screenResolution: string
  windowSize: string
  timezone: string
  connectionType: string
  appVersion: string
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

// Diagnostic event types
export type DiagnosticEventType =
  | 'status_change'
  | 'error'
  | 'playback_change'
  | 'device_event'
  | 'queue_operation'
  | 'token_event'

export interface DiagnosticEvent {
  type: DiagnosticEventType
  timestamp: number
  message: string
  details?: Record<string, unknown>
  severity?: 'info' | 'warning' | 'error'
}

// Playback diagnostic details
export interface PlaybackDetails {
  currentTrack?: {
    id: string
    name: string
    artist: string
    uri: string
  }
  progress?: number
  duration?: number
  isPlaying: boolean
  isStalled?: boolean
  lastProgressUpdate?: number
}

// Queue state information
export interface QueueState {
  nextTrack?: {
    id: string
    name: string
    artist: string
    queueId: string
  }
  queueLength: number
  isEmpty: boolean
  hasNextTrack: boolean
}

// Failure metrics
export interface FailureMetrics {
  consecutiveFailures: number
  lastSuccessfulOperation?: number
  lastFailureTimestamp?: number
  totalFailures?: number
}
