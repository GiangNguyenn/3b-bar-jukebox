export interface SpotifyUserProfile {
  display_name: string
  external_urls: {
    spotify: string
  }
  followers: {
    href: string | null
    total: number
  }
  href: string
  id: string
  images: {
    height: number | null
    url: string
    width: number | null
  }[]
  type: string
  uri: string
  product:
    | 'free'
    | 'premium'
    | 'premium_duo'
    | 'premium_family'
    | 'premium_student'
    | 'open'
}
export interface SpotifyArtist {
  name: string
}

export interface SpotifyDevice {
  id: string
  is_active: boolean
  is_private_session: boolean
  is_restricted: boolean
  name: string
  type: string
  volume_percent: number
}

export type TrackDetails = TrackItem['track'] & { uri: string }

export interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

export interface TrackItem {
  added_at: string
  added_by: {
    id: string
    type: string
    uri: string
    href: string
    external_urls: {
      spotify: string
    }
  }
  is_local: boolean
  track: {
    id: string
    uri: string
    name: string
    artists: { name: string }[]
    album: {
      name: string
      images: { url: string }[]
      release_date: string
    }
    duration_ms: number
    popularity: number
    preview_url: string | null
    is_playable: boolean
    explicit: boolean
  }
}

export interface SpotifyPlaylistItem {
  id: string
  name: string
  snapshot_id: string
  tracks: {
    items: TrackItem[]
    total: number
  }
}

export interface SpotifyPlaybackState {
  is_playing: boolean
  progress_ms: number
  timestamp: number
  context: {
    uri: string
  }
  device: {
    id: string
    is_active: boolean
    is_private_session: boolean
    is_restricted: boolean
    name: string
    type: string
    volume_percent: number
  }
  item: {
    id: string
    uri: string
    duration_ms: number
    name: string
    artists: { name: string }[]
    album: {
      name: string
      images: { url: string }[]
    }
  }
}

export interface UserQueue {
  queue: {
    id: string
    name: string
    artists: { name: string }[]
    album: {
      name: string
      images: { url: string }[]
    }
    duration_ms: number
  }[]
}

export interface SpotifySDKPlaybackState {
  position: number
  duration: number
  track_window: {
    current_track: {
      id: string
      uri: string
      name: string
      artists: { name: string }[]
      album: {
        name: string
        images: { url: string }[]
      }
      duration_ms: number
    }
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
}

export interface SpotifyPlayerInstance {
  connect(): Promise<boolean>
  disconnect(): void
  getCurrentState(): Promise<SpotifySDKPlaybackState | null>
  setName(name: string): Promise<void>
  getVolume(): Promise<number>
  setVolume(volume: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  activateElement(): Promise<void>
}

export interface SpotifySDK {
  Player: new (config: {
    name: string
    getOAuthToken: (cb: (token: string) => void) => void
    volume?: number
  }) => SpotifyPlayerInstance
}

export interface SpotifyErrorResponse {
  error: {
    status: number
    message: string
  }
}
