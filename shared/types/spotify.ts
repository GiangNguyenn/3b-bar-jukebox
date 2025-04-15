export interface SpotifyArtist {
  name: string
}

export interface SpotifyAlbum {
  name: string
  images: Array<{
    url: string
    height: number
    width: number
  }>
}

export interface SpotifyTrack {
  id: string
  name: string
  artists: SpotifyArtist[]
  album: SpotifyAlbum
}

export interface SpotifyPlaybackState {
  is_playing: boolean
  item: SpotifyTrack | null
} 