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
  id: string
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

export type TrackDetails = TrackItem['tracks'] & { uri: string; genre?: string }

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
  tracks: {
    id: string
    uri: string
    name: string
    external_urls?: {
      spotify: string
    }
    artists: { name: string; id: string }[]
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
    artists: Array<{ name: string; id?: string }>
    album: {
      name: string
      images: { url: string }[]
    }
  }
}

export interface SpotifyPlayerQueue {
  currently_playing: TrackDetails
  queue: TrackDetails[]
}

export interface SpotifyErrorResponse {
  error: {
    status: number
    message: string
  }
  details?: string
}
