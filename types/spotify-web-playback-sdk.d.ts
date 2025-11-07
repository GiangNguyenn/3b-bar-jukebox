/**
 * Type definitions for Spotify Web Playback SDK
 * These extend the Window interface to include Spotify SDK globals
 */

declare global {
  interface Window {
    Spotify?: typeof Spotify
    spotifyPlayerInstance?: Spotify.Player | null
    onSpotifyWebPlaybackSDKReady?: () => void
    onSpotifyWebPlaybackSDKError?: (error: unknown) => void
  }

  namespace Spotify {
    interface Player {
      connect(): Promise<boolean>
      disconnect(): void
      getCurrentState(): Promise<PlaybackState | null>
      setName(name: string): Promise<void>
      getVolume(): Promise<number>
      setVolume(volume: number): Promise<void>
      pause(): Promise<void>
      resume(): Promise<void>
      previousTrack(): Promise<void>
      nextTrack(): Promise<void>
      activateElement(): Promise<void>
      addListener(
        event: 'ready',
        callback: (device: { device_id: string }) => void
      ): void
      addListener(
        event: 'not_ready',
        callback: (device: { device_id: string }) => void
      ): void
      addListener(
        event: 'player_state_changed',
        callback: (state: PlaybackState | null) => void
      ): void
      addListener(
        event: 'initialization_error',
        callback: (error: { message: string }) => void
      ): void
      addListener(
        event: 'authentication_error',
        callback: (error: { message: string }) => void
      ): void
      addListener(
        event: 'account_error',
        callback: (error: { message: string }) => void
      ): void
      addListener(
        event: 'playback_error',
        callback: (error: { message: string }) => void
      ): void
      removeListener(
        event:
          | 'ready'
          | 'not_ready'
          | 'player_state_changed'
          | 'initialization_error'
          | 'authentication_error'
          | 'account_error'
          | 'playback_error'
      ): void
    }

    interface PlaybackState {
      context: {
        uri: string
        metadata: Record<string, unknown>
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
      paused: boolean
      position: number
      duration: number
      repeat_mode: number
      shuffle: boolean
      track_window: {
        current_track: Track
        previous_tracks: Track[]
        next_tracks: Track[]
      }
    }

    interface Track {
      id: string
      uri: string
      type: string
      linked_from_uri: string | null
      linked_from: {
        uri: string | null
        id: string | null
      }
      media_type: string
      name: string
      duration_ms: number
      artists: Artist[]
      album: Album
      is_playable: boolean
    }

    interface Artist {
      name: string
      uri: string
    }

    interface Album {
      uri: string
      name: string
      images: Image[]
    }

    interface Image {
      url: string
      height?: number
      width?: number
    }

    interface PlayerInit {
      name: string
      getOAuthToken: (cb: (token: string) => void) => void
      volume?: number
    }

    const Player: {
      new (options: PlayerInit): Player
    }
  }
}

export {}
