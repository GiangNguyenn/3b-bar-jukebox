declare global {
  interface Window {
    Spotify: {
      Player: new (options: SpotifyPlayerOptions) => SpotifyPlayerInstance
    }
    spotifyPlayerInstance: SpotifyPlayerInstance | null
    refreshSpotifyPlayer: () => Promise<void>
    spotifySDKLoading: boolean
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

export {}
