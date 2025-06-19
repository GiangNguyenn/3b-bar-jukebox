export interface HealthStatus {
  deviceId: string | null
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown' | 'error'
  playback: 'playing' | 'paused' | 'stopped' | 'unknown' | 'error'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  tokenExpiringSoon: boolean
  connection: 'connected' | 'disconnected' | 'unknown'
  fixedPlaylist: 'found' | 'not_found' | 'error' | 'unknown'
}
