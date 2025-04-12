declare global {
  interface Window {
    Spotify: {
      Player: new (options: SpotifyPlayerOptions) => SpotifyPlayerInstance
    }
    spotifyPlayerInstance: SpotifyPlayerInstance | null
    refreshSpotifyPlayer: () => Promise<void>
  }
}

export interface SpotifyPlayerOptions {
  name: string
  getOAuthToken: (callback: (token: string) => void) => void
  volume: number
}

export interface SpotifyPlayerInstance {
  connect(): Promise<boolean>
  disconnect(): Promise<void>
  addListener(eventName: string, callback: (event: any) => void): void
  removeListener(eventName: string, callback: (event: any) => void): void
}

export {}
