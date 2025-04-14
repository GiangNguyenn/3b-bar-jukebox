export type SpotifyPlaylists = {
  href: string
  limit: number
  next: string | null
  offset: number
  previous: string | null
  total: number
  items: SpotifyPlaylistItem[]
}

export type SpotifyPlaylistItem = {
  collaborative: boolean
  description: string
  external_urls: {
    spotify: string
  }
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

type SpotifyImage = {
  url: string
  height: number | null
  width: number | null
}

type SpotifyOwner = {
  external_urls: {
    spotify: string
  }
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

export interface CreatePlaylistRequest {
  name: string
  description: string
  public: boolean
}

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
  album: Album
  artists: Artist[]
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
}

export interface Album {
  album_type: string
  total_tracks: number
  available_markets: string[]
  external_urls: { spotify: string }
  href: string
  id: string
  images: { url: string; height: number; width: number }[]
  name: string
  release_date: string
  release_date_precision: string
  restrictions?: { reason: string }
  type: string
  uri: string
  artists: Artist[]
}

export interface Artist {
  external_urls: { spotify: string }
  href: string
  id: string
  name: string
  type: string
  uri: string
}

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
    external_urls: {
      spotify: string
    }
    uri: string
  }
  timestamp: number
  progress_ms: number
  is_playing: boolean
  item: {
    album: Album
    artists: Artist[]
    available_markets: string[]
    disc_number: number
    duration_ms: number
    explicit: boolean
    external_ids: {
      isrc: string
      ean: string
      upc: string
    }
    external_urls: {
      spotify: string
    }
    href: string
    id: string
    is_playable: boolean
    linked_from?: object
    restrictions?: {
      reason: string
    }
    name: string
    popularity: number
    preview_url: string
    track_number: number
    type: string
    uri: string
    is_local: boolean
  }
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
}

export type UserQueue = {
  currently_playing: {
    album: Album
    artists: Artist[]
    available_markets: string[]
    disc_number: number
    duration_ms: number
    explicit: boolean
    external_ids: {
      isrc: string
    }
    external_urls: {
      spotify: string
    }
    href: string
    id: string
    is_local: boolean
    name: string
    popularity: number
    preview_url?: string
    track_number: number
    type: string
    uri: string
  }
  queue: [
    {
      album: Album
      artists: Artist[]
      available_markets: string[]
      disc_number: number
      duration_ms: number
      external_ids: {
        isrc: string
      }
      external_urls: {
        spotify: string
      }
      href: string
      id: string
      is_local: boolean
      name: string
      popularity: number
      preview_url: string
      track_number: number
      type: string
      uri: string
    }
  ]
}

export interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
  creation_time: number
}

export interface TokenInfo {
  lastRefresh: number
  expiresIn: number
  scope: string
  type: string
  lastActualRefresh: number
  expiryTime: number
}
