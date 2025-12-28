import { createClient } from '@supabase/supabase-js'
import { sendApiRequest } from '@/shared/api'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('MetadataBackfill')

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

interface BackfillResult {
  success: boolean
  updatedTrackName?: string
  error?: string
}

/**
 * Validates and backfills a single track's metadata from Spotify.
 * This includes: release_year, genre, spotify_url, popularity, album name, duration.
 */
export async function backfillTrackMetadata(
  spotifyTrackId: string,
  token: string
): Promise<BackfillResult> {
  try {
    // 1. Fetch track details from Spotify
    const trackData = await sendApiRequest<{
      name: string
      album: { release_date: string; name: string }
      artists: Array<{ id: string; name: string }>
      popularity: number
      duration_ms: number
      external_urls: { spotify: string }
    }>({
      path: `tracks/${spotifyTrackId}`,
      method: 'GET',
      token,
      retryConfig: { maxRetries: 2, baseDelay: 500, maxDelay: 2000 }
    })

    if (!trackData) {
      logger(
        'WARN',
        `Spotify returned no data for track ${spotifyTrackId}. Marking as un-backfillable.`
      )

      // Mark as un-backfillable by setting sentinel values
      await supabase
        .from('tracks')
        .update({
          release_year: 0,
          genre: 'Unknown',
          spotify_url: 'unavailable'
        })
        .eq('spotify_track_id', spotifyTrackId)

      return {
        success: false,
        error: 'No data from Spotify - marked as un-backfillable'
      }
    }

    // 2. Parse Release Year
    let releaseYear: number | null = null
    if (trackData.album?.release_date) {
      const yearStr = trackData.album.release_date.split('-')[0]
      const year = parseInt(yearStr, 10)
      if (!isNaN(year)) {
        releaseYear = year
      }
    }

    // 3. Prepare Update Object
    const updateData: Record<string, any> = {
      release_year: releaseYear,
      popularity: trackData.popularity,
      duration_ms: trackData.duration_ms,
      spotify_url: trackData.external_urls?.spotify,
      album: trackData.album?.name
      // Note: We don't automatically overwrite genre here because genre backfill
      // is complex (requires artist fetch).
    }

    // 4. Update Database
    const { error } = await supabase
      .from('tracks')
      .update(updateData)
      .eq('spotify_track_id', spotifyTrackId)

    if (error) {
      logger(
        'ERROR',
        `Failed to update track ${spotifyTrackId} in DB`,
        undefined,
        error
      )
      return { success: false, error: error.message }
    }

    // 5. Trigger Artist/Genre Backfill (Chained)
    if (trackData.artists && trackData.artists.length > 0) {
      const mainArtist = trackData.artists[0]
      try {
        const { backfillTrackGenre, fetchGenresFromMusicBrainz } = await import(
          './genreBackfill'
        )

        // Try standard backfill first (Spotify)
        let genreBackfilled = await backfillTrackGenre(
          spotifyTrackId,
          mainArtist.name,
          releaseYear,
          trackData.popularity,
          token
        )

        // If no genre found via Spotify, try MusicBrainz directly
        if (!genreBackfilled) {
          logger(
            'INFO',
            `Spotify genre backfill failed for ${mainArtist.name}, trying MusicBrainz...`
          )
          const mbGenres = await fetchGenresFromMusicBrainz(mainArtist.name)

          if (mbGenres && mbGenres.length > 0) {
            // Update DB with MB genre
            const mbGenre = mbGenres[0]
            await supabase
              .from('tracks')
              .update({ genre: mbGenre })
              .eq('spotify_track_id', spotifyTrackId)

            logger(
              'INFO',
              `MusicBrainz backfill success: Updated genre to "${mbGenre}"`
            )
          }
        }
      } catch (genreError) {
        logger(
          'WARN',
          `Genre backfill sub-task failed for ${spotifyTrackId}`,
          undefined,
          genreError instanceof Error ? genreError : undefined
        )
      }
    }

    logger('INFO', `Successfully backfilled metadata for "${trackData.name}"`)
    return { success: true, updatedTrackName: trackData.name }
  } catch (error) {
    logger(
      'ERROR',
      `Exception backfilling ${spotifyTrackId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Finds a random track with missing metadata and backfills it.
 */
export async function backfillRandomMissingTrack(
  token: string
): Promise<BackfillResult | null> {
  try {
    // Find a candidate track
    // Priority: Missing release_year OR Missing genre OR Missing URL
    const { data: tracks, error } = await supabase
      .from('tracks')
      .select('spotify_track_id')
      .or('release_year.is.null,genre.is.null,spotify_url.is.null')
      // To get a random one, we can't easily use .order('random()') with JS client directly efficiently on large tables without RPC
      // But for a drip feed, picking from the top 100 inconsistent rows is fine.
      // Ideally we'd use an RPC for true random, but let's just fetch a small batch and pick one.
      .limit(20)

    if (error) {
      logger(
        'ERROR',
        'Failed to query candidates for backfill',
        undefined,
        error
      )
      return { success: false, error: error.message }
    }

    if (!tracks || tracks.length === 0) {
      return null // Nothing to backfill!
    }

    // Pick random one from batch
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)]

    // Execute backfill
    return await backfillTrackMetadata(randomTrack.spotify_track_id, token)
  } catch (e) {
    logger(
      'ERROR',
      'Exception in backfillRandomMissingTrack',
      undefined,
      e instanceof Error ? e : undefined
    )
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error'
    }
  }
}
