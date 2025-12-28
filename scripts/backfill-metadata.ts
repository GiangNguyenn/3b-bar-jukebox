import { createClient } from '@supabase/supabase-js'
import { getAdminSpotifyCredentials } from '@/services/spotifyApiServer'
import { backfillTrackMetadata } from '@/services/game/metadataBackfill'

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function backfillMetadata() {
  console.log('Starting metadata backfill...')

  // Get admin token for Spotify API
  const credentials = await getAdminSpotifyCredentials()
  if (!credentials) {
    console.error('Failed to get Spotify credentials')
    return
  }
  const token = credentials.spotify_access_token

  // Fetch tracks with missing release_year or genre
  // Limit to 50 to avoid rate limits initially
  const { data: tracks, error } = await supabase
    .from('tracks')
    .select('spotify_track_id, name, artist, genre, release_year')
    .or('release_year.is.null,genre.is.null')
    .limit(50)

  if (error) {
    console.error('Error fetching tracks:', error)
    return
  }

  console.log(`Found ${tracks.length} tracks to backfill...`)

  let successCount = 0
  let failCount = 0

  for (const track of tracks) {
    if (!track.spotify_track_id || !track.artist) continue

    console.log(`Backfilling ${track.name} (${track.artist})...`)
    try {
      const success = await backfillTrackMetadata(track.spotify_track_id, token)
      if (success) successCount++
      else failCount++

      // Small delay to be nice to API
      await new Promise((r) => setTimeout(r, 200))
    } catch (e) {
      console.error(`Failed to backfill ${track.name}:`, e)
      failCount++
    }
  }

  console.log(`Batch complete. Success: ${successCount}, Failed: ${failCount}`)
}

backfillMetadata()
