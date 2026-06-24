import type { JukeboxQueueItem } from '@/shared/types/queue'

export const mockQueueItem: JukeboxQueueItem = {
  id: 'queue-uuid-1',
  track_id: 'db-id-1',
  profile_id: 'user-1',
  tracks: {
    id: 'db-id-1',
    spotify_track_id: 'id-original',
    name: 'Wonderwall - Remastered',
    artist: 'Oasis',
    duration_ms: 200000,
    album: 'Morning Glory',
    genre: 'Rock',
    created_at: new Date().toISOString(),
    popularity: 80,
    spotify_url: 'https://open.spotify.com/track/id-original',
    release_year: 1995
  },
  votes: 0,
  queued_at: new Date().toISOString()
}
