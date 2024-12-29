export type SpotifyPlaylists = {
  href: string;
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
  items: SpotifyPlaylistItem[];
};

export type SpotifyPlaylistItem = {
  collaborative: boolean;
  description: string;
  external_urls: {
    spotify: string;
  };
  href: string;
  id: string;
  images: SpotifyImage[];
  name: string;
  owner: SpotifyOwner;
  public: boolean;
  snapshot_id: string;
  tracks: {
    href: string;
    total: number;
    limit: number;
    offset: number;
    items: TrackItem[];
  }
  type: string;
  uri: string;
};

type SpotifyImage = {
  url: string;
  height: number | null;
  width: number | null;
};

type SpotifyOwner = {
  external_urls: {
    spotify: string;
  };
  followers: {
    href: string | null;
    total: number;
  };
  href: string;
  id: string;
  type: string; // Usually "user"
  uri: string;
  display_name: string;
};

export interface CreatePlaylistRequest {
  name: string;
  description: string;
  public: boolean;
}

export interface TrackItem {
  added_at: string;
  added_by: {
    external_urls: { spotify: string };
    href: string;
    id: string;
    type: string;
    uri: string;
  };
  is_local: boolean;
  track: TrackDetails;
}

export interface TrackDetails {
  album: Album;
  artists: Artist[];
  available_markets: string[];
  disc_number: number;
  duration_ms: number;
  explicit: boolean;
  external_ids: { isrc?: string; ean?: string; upc?: string };
  external_urls: { spotify: string };
  href: string;
  id: string;
  is_playable: boolean;
  restrictions?: { reason: string };
  name: string;
  popularity: number;
  preview_url?: string | null;
  track_number: number;
  type: string;
  uri: string;
  is_local: boolean;
}

export interface Album {
  album_type: string;
  total_tracks: number;
  available_markets: string[];
  external_urls: { spotify: string };
  href: string;
  id: string;
  images: { url: string; height: number; width: number }[];
  name: string;
  release_date: string;
  release_date_precision: string;
  restrictions?: { reason: string };
  type: string;
  uri: string;
  artists: Artist[];
}

export interface Artist {
  external_urls: { spotify: string };
  href: string;
  id: string;
  name: string;
  type: string;
  uri: string;
}
