// Database track structure (from tracks table)
export interface DatabaseTrack {
  id: string
  spotify_track_id: string
  name: string
  artist: string
  album: string
  genre: string | null
  created_at: string
  popularity: number
  duration_ms: number
  spotify_url: string
  release_year: number
}

export interface JukeboxQueueItem {
  id: string
  profile_id: string
  track_id: string
  votes: number
  queued_at: string
  tracks: DatabaseTrack
}
