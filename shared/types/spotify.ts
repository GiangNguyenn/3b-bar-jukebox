// Core Spotify API Types
export interface SpotifyArtist {
  name: string
  external_urls: { spotify: string }
  href: string
  id: string
  type: string
  uri: string
}

export interface SpotifyAlbum {
  name: string
  album_type: string
  total_tracks: number
  available_markets: string[]
  external_urls: { spotify: string }
  href: string
  id: string
  images: SpotifyImage[]
  release_date: string
  release_date_precision: string
  restrictions?: { reason: string }
  type: string
  uri: string
  artists: SpotifyArtist[]
}

export interface SpotifyImage {
  url: string
  height: number | null
  width: number | null
}

export interface SpotifyTrack {
  id: string
  name: string
  artists: SpotifyArtist[]
  album: SpotifyAlbum
  uri: string
  duration_ms: number
  available_markets: string[]
  disc_number: number
  explicit: boolean
  external_ids: { isrc?: string; ean?: string; upc?: string }
  external_urls: { spotify: string }
  href: string
  is_playable: boolean
  restrictions?: { reason: string }
  popularity: number
  preview_url?: string | null
  track_number: number
  type: string
  is_local: boolean
  genres?: string[]
}

// Playlist Types
export interface SpotifyPlaylists {
  href: string
  limit: number
  next: string | null
  offset: number
  previous: string | null
  total: number
  items: SpotifyPlaylistItem[]
}

export interface SpotifyPlaylistItem {
  collaborative: boolean
  description: string
  external_urls: { spotify: string }
  href: string
  id: string
  images: SpotifyImage[]
  name: string
  owner: SpotifyOwner
  public: boolean
  snapshot_id: string
  tracks: {
    href: string
    total: number
    limit: number
    offset: number
    items: TrackItem[]
  }
  type: string
  uri: string
}

export interface SpotifyOwner {
  external_urls: { spotify: string }
  followers: {
    href: string | null
    total: number
  }
  href: string
  id: string
  type: string // Usually "user"
  uri: string
  display_name: string
}

// Track Types
export interface TrackItem {
  added_at: string
  added_by: {
    external_urls: { spotify: string }
    href: string
    id: string
    type: string
    uri: string
  }
  is_local: boolean
  track: TrackDetails
}

export interface TrackDetails {
  album: SpotifyAlbum
  artists: SpotifyArtist[]
  available_markets: string[]
  disc_number: number
  duration_ms: number
  explicit: boolean
  external_ids: { isrc?: string; ean?: string; upc?: string }
  external_urls: { spotify: string }
  href: string
  id: string
  is_playable: boolean
  restrictions?: { reason: string }
  name: string
  popularity: number
  preview_url?: string | null
  track_number: number
  type: string
  uri: string
  is_local: boolean
  genres?: string[]
  linked_from?: object
}

// Playback Types
export interface SpotifyPlaybackState {
  device: {
    id: string
    is_active: boolean
    is_private_session: boolean
    is_restricted: boolean
    name: string
    type: string
    volume_percent: number
    supports_volume: boolean
  }
  repeat_state: string
  shuffle_state: boolean
  context: {
    type: string
    href: string
    external_urls: { spotify: string }
    uri: string
  }
  timestamp: number
  progress_ms: number
  is_playing: boolean
  item: TrackDetails | null
  currently_playing_type: string
  actions: {
    interrupting_playback: boolean
    pausing: boolean
    resuming: boolean
    seeking: boolean
    skipping_next: boolean
    skipping_prev: boolean
    toggling_repeat_context: boolean
    toggling_shuffle: boolean
    toggling_repeat_track: boolean
    transferring_playback: boolean
  }
  error?: {
    status: number
    message: string
  }
}

// Queue Types
export interface UserQueue {
  currently_playing: TrackDetails | null
  queue: TrackDetails[]
}

// Device Types
export interface SpotifyDevice {
  id: string
  is_active: boolean
  is_private_session: boolean
  is_restricted: boolean
  name: string
  type: string
  volume_percent: number
  supports_volume: boolean
}

// User Profile Types
export interface SpotifyUserProfile {
  country: string
  display_name: string
  email: string
  explicit_content: {
    filter_enabled: boolean
    filter_locked: boolean
  }
  external_urls: { spotify: string }
  followers: {
    href: string | null
    total: number
  }
  href: string
  id: string
  images: SpotifyImage[]
  product: string
  type: string
  uri: string
}

// Token Types
export interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
  creation_time?: number
}

// Error Types
export interface SpotifyErrorResponse {
  error: {
    status: number
    message: string
  }
}

// SDK Types (for Spotify Web Playback SDK)
export interface SpotifySDKPlaybackState {
  position: number
  duration: number
  track_window: {
    current_track: TrackDetails
    previous_tracks: TrackDetails[]
    next_tracks: TrackDetails[]
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
  repeat_mode: number
  shuffle: boolean
  is_paused: boolean
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
  addListener(
    event: string,
    callback: (state: SpotifySDKPlaybackState) => void
  ): void
  removeListener(event: string): void
  togglePlay(): Promise<void>
  seek(position_ms: number): Promise<void>
}

export interface SpotifySDK {
  Player: new (config: {
    name: string
    getOAuthToken: (cb: (token: string) => void) => void
    volume?: number
    robustness?: 'LOW' | 'MEDIUM' | 'HIGH'
  }) => SpotifyPlayerInstance
}

// Legacy aliases for backward compatibility
export type Album = SpotifyAlbum
export type Artist = SpotifyArtist
