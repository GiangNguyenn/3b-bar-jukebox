declare global {
  interface Window {
    Spotify: {
      Player: new (options: SpotifyPlayerOptions) => SpotifyPlayerInstance
    }
    spotifyPlayerInstance: any // Use any to avoid type conflicts with SDK
    refreshSpotifyPlayer: () => Promise<void>
    spotifySDKLoading: boolean
    initializeSpotifyPlayer: () => Promise<void>
  }
}

export interface SpotifyPlayerOptions {
  name: string
  getOAuthToken: (callback: (token: string) => void) => void
  volume: number
  robustness?: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface SpotifyPlayerInstance {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(
    eventName: 'ready',
    callback: (event: { device_id: string }) => void
  ): void
  addListener(
    eventName: 'not_ready',
    callback: (event: { device_id: string }) => void
  ): void
  addListener(
    eventName: 'player_state_changed',
    callback: (state: SpotifyPlaybackState) => void
  ): void
  addListener(
    eventName:
      | 'initialization_error'
      | 'authentication_error'
      | 'account_error',
    callback: (event: { message: string }) => void
  ): void
  removeListener(eventName: string, callback: (event: any) => void): void
}

export interface SpotifyPlaybackState {
  context: {
    uri: string
    metadata: Record<string, string>
  }
  disallows: {
    pausing: boolean
    peeking_next: boolean
    peeking_prev: boolean
    resuming: boolean
    seeking: boolean
    skipping_next: boolean
    skipping_prev: boolean
  }
  duration: number
  paused: boolean
  position: number
  repeat_mode: number
  shuffle: boolean
  track_window: {
    current_track: SpotifyTrack
    previous_tracks: SpotifyTrack[]
    next_tracks: SpotifyTrack[]
  }
  volume: number
  device_id: string
}

export interface SpotifyTrack {
  uri: string
  id: string
  type: string
  media_type: string
  name: string
  is_playable: boolean
  album: {
    uri: string
    name: string
    images: Array<{
      url: string
      height: number | null
      width: number | null
    }>
  }
  artists: Array<{
    uri: string
    name: string
  }>
}

export {}
