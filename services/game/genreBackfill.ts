/**
 * Lazy genre backfilling utilities
 * Automatically updates tracks and artists with missing genres when encountered
 */

import { supabase, queryWithRetry } from '@/lib/supabase'
import { sendApiRequest } from '@/shared/api'
import { createModuleLogger } from '@/shared/utils/logger'
import { upsertArtistProfile } from './dgsCache'
import { GENRE_MAPPINGS, COMPOUND_GENRE_MAPPINGS } from './genreConstants'

const logger = createModuleLogger('GenreBackfill')

// Deduplication: Track ongoing backfill operations to prevent duplicate attempts
const ongoingTrackBackfills = new Set<string>()
const ongoingArtistBackfills = new Set<string>()

// Completion cache: Track recently completed backfills to prevent re-triggering
// Key: artistId or trackId, Value: timestamp of completion
const completedBackfills = new Map<string, number>()
const COMPLETION_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Metrics: Track backfill performance
interface BackfillMetrics {
  trackAttempts: number
  trackSuccesses: number
  trackFailures: number
  artistAttempts: number
  artistSuccesses: number
  artistFailures: number
}

const metrics: BackfillMetrics = {
  trackAttempts: 0,
  trackSuccesses: 0,
  trackFailures: 0,
  artistAttempts: 0,
  artistSuccesses: 0,
  artistFailures: 0
}

// Concurrency control
let activeBackfills = 0
const MAX_CONCURRENT_BACKFILLS = 2 // Strict limit to prevent rate limits

/**
 * Get current backfill metrics
 */
export function getBackfillMetrics(): BackfillMetrics {
  return { ...metrics }
}

/**
 * Normalize genre name to match Spotify conventions
 */
function normalizeGenre(genre: string): string {
  return genre
    .trim()
    .split(/[,\/&]/)[0] // Take first genre if multiple
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Map Wikipedia genres to Spotify-compatible genres
 */
function mapWikipediaGenreToSpotify(wikiGenre: string): string | null {
  const normalized = normalizeGenre(wikiGenre).toLowerCase()

  // Common genre mappings
  // Common genre mappings
  const genreMap = GENRE_MAPPINGS

  // Handle compound genres (e.g., "bedroom pop" -> "Pop", "arena rock" -> "Rock")
  // Handle compound genres (e.g., "bedroom pop" -> "Pop", "arena rock" -> "Rock")
  const compoundGenres = COMPOUND_GENRE_MAPPINGS

  // Check compound genres first
  for (const [key, value] of Object.entries(compoundGenres)) {
    if (normalized.includes(key)) {
      return value
    }
  }

  // Direct match
  if (genreMap[normalized]) {
    return genreMap[normalized]
  }

  // Partial match (check if normalized contains a known genre)
  for (const [key, value] of Object.entries(genreMap)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value
    }
  }

  // Return capitalized version if no match (but filter out if it looks like CSS/technical)
  const capitalized = wikiGenre.split(/[,\/&]/)[0].trim()
  const lowerCap = capitalized.toLowerCase()
  if (
    lowerCap.includes('.') ||
    lowerCap.includes(':') ||
    lowerCap.includes('{') ||
    lowerCap.length > 30
  ) {
    return null // Don't return CSS-like content
  }

  return capitalized
}

/**
 * Get genres from related artists in database
 */
async function getGenresFromRelatedArtists(
  spotifyArtistId: string
): Promise<string[]> {
  try {
    // Get related artists
    const { data: relations, error } = await queryWithRetry<
      Array<{ related_spotify_artist_id: string }>
    >(
      supabase
        .from('artist_relationships')
        .select('related_spotify_artist_id')
        .eq('source_spotify_artist_id', spotifyArtistId)
        .limit(20),
      undefined,
      'Get related artists for genre fallback'
    )

    if (error || !relations || relations.length === 0) {
      return []
    }

    const relatedIds = relations.map((r) => r.related_spotify_artist_id)

    // Get genres from related artists
    const { data: artists, error: artistsError } = await queryWithRetry<
      Array<{ genres: string[] | null }>
    >(
      supabase
        .from('artists')
        .select('genres')
        .in('spotify_artist_id', relatedIds)
        .not('genres', 'is', null),
      undefined,
      'Get genres from related artists'
    )

    if (artistsError || !artists || artists.length === 0) {
      return []
    }

    // Count genre frequency
    const genreCounts = new Map<string, number>()
    artists.forEach((artist) => {
      if (artist.genres && artist.genres.length > 0) {
        artist.genres.forEach((genre) => {
          genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)
        })
      }
    })

    // Return most common genres
    return Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre)
  } catch (error) {
    logger(
      'WARN',
      `Failed to get genres from related artists for ${spotifyArtistId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return []
  }
}

/**
 * Fetch genres from MusicBrainz for an artist
 */
async function fetchGenresFromMusicBrainz(
  artistName: string
): Promise<string[]> {
  try {
    logger(
      'INFO',
      `[MusicBrainz] Step 1: Searching MusicBrainz for "${artistName}"`
    )

    // Step 1: Search for artist in MusicBrainz
    const searchResponse = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`,
      {
        headers: {
          'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
        }
      }
    )

    if (!searchResponse.ok) {
      logger(
        'WARN',
        `[MusicBrainz] Step 1 failed: MusicBrainz search returned status ${searchResponse.status} for "${artistName}"`
      )
      return []
    }

    const searchData = (await searchResponse.json()) as {
      artists: Array<{ id: string; name: string }>
    }

    if (!searchData.artists || searchData.artists.length === 0) {
      logger(
        'WARN',
        `[MusicBrainz] Step 1 failed: No artists found in MusicBrainz for "${artistName}"`
      )
      return []
    }

    logger(
      'INFO',
      `[MusicBrainz] Step 1 result: Found ${searchData.artists.length} artists in MusicBrainz`
    )

    // Find exact match
    const exactMatch = searchData.artists.find(
      (artist) => artist.name.toLowerCase() === artistName.toLowerCase()
    )

    if (!exactMatch) {
      const foundNames = searchData.artists
        .slice(0, 5)
        .map((a) => a.name)
        .join(', ')
      logger(
        'WARN',
        `[MusicBrainz] Step 1 failed: No exact match for "${artistName}". Found: ${foundNames}${searchData.artists.length > 5 ? '...' : ''}`
      )
      return []
    }

    logger(
      'INFO',
      `[MusicBrainz] Step 1 success: Found exact match "${exactMatch.name}" (ID: ${exactMatch.id})`
    )

    // Step 2: Fetch artist details with genres
    logger(
      'INFO',
      `[MusicBrainz] Step 2: Fetching genres for MusicBrainz artist ${exactMatch.id}`
    )
    const artistResponse = await fetch(
      `https://musicbrainz.org/ws/2/artist/${exactMatch.id}?inc=genres&fmt=json`,
      {
        headers: {
          'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
        }
      }
    )

    if (!artistResponse.ok) {
      logger(
        'WARN',
        `[MusicBrainz] Step 2 failed: Artist fetch returned status ${artistResponse.status} for "${artistName}"`
      )
      return []
    }

    const artistData = (await artistResponse.json()) as {
      genres?: Array<{ name: string; count: number }>
    }

    if (!artistData.genres || artistData.genres.length === 0) {
      logger(
        'WARN',
        `[MusicBrainz] Step 2 failed: No genres found for "${artistName}"`
      )
      return []
    }

    logger(
      'INFO',
      `[MusicBrainz] Step 2 result: Found ${artistData.genres.length} genres for "${artistName}"`
    )

    // Step 3: Map genres to Spotify-compatible genres and sort by count
    const mappedGenres = artistData.genres
      .map((g) => mapWikipediaGenreToSpotify(g.name))
      .filter((g): g is string => g !== null)

    // Deduplicate genres (case-insensitive)
    const uniqueGenres = Array.from(
      new Map(mappedGenres.map((g) => [g.toLowerCase(), g])).values()
    )

    // Sort by original count (from MusicBrainz) and take top 3
    const genreCounts = new Map<string, number>()
    artistData.genres.forEach((g) => {
      const mapped = mapWikipediaGenreToSpotify(g.name)
      if (mapped) {
        const key = mapped.toLowerCase()
        const currentCount = genreCounts.get(key) || 0
        genreCounts.set(key, currentCount + g.count)
      }
    })

    // Sort by count descending and take top 3
    const finalGenres = uniqueGenres
      .sort((a, b) => {
        const countA = genreCounts.get(a.toLowerCase()) || 0
        const countB = genreCounts.get(b.toLowerCase()) || 0
        return countB - countA
      })
      .slice(0, 3)

    if (finalGenres.length > 0) {
      logger(
        'INFO',
        `[MusicBrainz] Successfully extracted genres for "${artistName}": ${finalGenres.join(', ')}`
      )
      console.log(
        `[GenreBackfill] ✅ MUSICBRAINZ SUCCESS: Found genres for "${artistName}": ${finalGenres.join(', ')}`
      )
    } else {
      logger(
        'WARN',
        `[MusicBrainz] Step 3 failed: No genres could be mapped to Spotify format for "${artistName}". Raw genres: ${artistData.genres.map((g) => g.name).join(', ')}`
      )
      console.log(
        `[GenreBackfill] ❌ MUSICBRAINZ FAILED: No mappable genres for "${artistName}". Raw: ${artistData.genres.map((g) => g.name).join(', ')}`
      )
    }

    return finalGenres
  } catch (error) {
    logger(
      'WARN',
      `Failed to fetch genres from MusicBrainz for ${artistName}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return []
  }
}

/**
 * Backfill artist genres with fallback strategies
 */
export async function backfillArtistGenres(
  spotifyArtistId: string,
  artistName: string,
  token?: string
): Promise<string[] | null> {
  try {
    // Validate artist ID before making API calls
    if (!spotifyArtistId || spotifyArtistId.trim() === '') {
      logger(
        'WARN',
        `[Backfill] Invalid or empty artist ID for "${artistName}"`
      )
      return null
    }

    logger(
      'INFO',
      `[Backfill] Starting genre backfill for "${artistName}" (${spotifyArtistId})`
    )

    // Check current state - use maybeSingle() to avoid throwing
    const { data: currentArtist } = await queryWithRetry<{
      genres: string[] | null
      popularity: number | null
      follower_count: number | null
    }>(
      supabase
        .from('artists')
        .select('genres, popularity, follower_count')
        .eq('spotify_artist_id', spotifyArtistId)
        .maybeSingle(),
      undefined,
      'Check artist metadata before backfill'
    )

    // Check if we already have ALL metadata
    const hasGenres = currentArtist?.genres && currentArtist.genres.length > 0
    const hasPopularity =
      currentArtist?.popularity !== null &&
      currentArtist?.popularity !== undefined
    const hasFollowers =
      currentArtist?.follower_count !== null &&
      currentArtist?.follower_count !== undefined

    if (hasGenres && hasPopularity && hasFollowers) {
      logger(
        'INFO',
        `[Backfill] Artist "${artistName}" already has complete metadata - skipping backfill`
      )
      return currentArtist.genres // Already has all metadata
    }

    logger(
      'INFO',
      `[Backfill] Artist "${artistName}" missing metadata (genres: ${hasGenres}, pop: ${hasPopularity}, followers: ${hasFollowers}) - proceeding with backfill`
    )

    // Strategy 1: Try Spotify API
    logger(
      'INFO',
      `[Backfill] Strategy 1: Attempting Spotify API for "${artistName}"`
    )
    // Variables to capture metadata
    let genres: string[] = []
    let popularity: number | undefined
    let followers: number | undefined

    try {
      const artistData = await sendApiRequest<{
        genres: string[]
        popularity?: number
        followers?: { total: number }
      }>({
        path: `artists/${spotifyArtistId}`,
        method: 'GET',
        useAppToken: !token,
        token,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 2000
        }
      })

      if (artistData?.genres && artistData.genres.length > 0) {
        genres = artistData.genres
        logger(
          'INFO',
          `[Backfill] Strategy 1 success: Spotify API returned genres for "${artistName}": ${genres.join(', ')}`
        )
      } else {
        logger(
          'WARN',
          `[Backfill] Strategy 1 failed: Spotify API returned no genres for "${artistName}"`
        )
      }

      // Capture metadata regardless of genres
      if (artistData) {
        popularity = artistData.popularity
        followers = artistData.followers?.total
        logger(
          'INFO',
          `[Backfill] Captured metadata for "${artistName}": Pop=${popularity}, Followers=${followers}`
        )
      }
    } catch (error) {
      logger(
        'WARN',
        `[Backfill] Strategy 1 failed: Spotify API error for artist ${spotifyArtistId}, trying fallbacks`,
        undefined,
        error instanceof Error ? error : undefined
      )
    }

    // Strategy 2: Related artists fallback
    if (genres.length === 0) {
      logger(
        'INFO',
        `[Backfill] Strategy 2: Attempting related artists fallback for "${artistName}"`
      )
      genres = await getGenresFromRelatedArtists(spotifyArtistId)
      if (genres.length > 0) {
        logger(
          'INFO',
          `[Backfill] Strategy 2 success: Used related artists genres for ${artistName}: ${genres.join(', ')}`
        )
      } else {
        logger(
          'WARN',
          `[Backfill] Strategy 2 failed: Related artists fallback returned no genres for "${artistName}"`
        )
      }
    } else {
      logger(
        'INFO',
        `[Backfill] Skipping related artists fallback for "${artistName}" - already have genres from Spotify API`
      )
    }

    // Strategy 2.5: MusicBrainz fallback
    if (genres.length === 0) {
      logger(
        'WARN',
        `[Backfill] Strategy 2.5: Attempting MusicBrainz fallback for "${artistName}"`
      )
      genres = await fetchGenresFromMusicBrainz(artistName)
      if (genres.length > 0) {
        logger(
          'WARN',
          `[Backfill] ✅ Strategy 2.5 SUCCESS: Used MusicBrainz genres for ${artistName}: ${genres.join(', ')}`
        )
      } else {
        logger(
          'WARN',
          `[Backfill] ❌ Strategy 2.5 FAILED: MusicBrainz fallback returned no genres for "${artistName}"`
        )
      }
    } else {
      logger(
        'INFO',
        `[Backfill] Skipping MusicBrainz fallback for "${artistName}" - already have genres from previous strategy`
      )
    }

    // Update database if we found NEW genres OR if we have valid metadata to update
    // Use existing genres from DB if we didn't fetch new ones
    const finalGenres = genres.length > 0 ? genres : currentArtist?.genres || []

    // Only update if we have something meaningful to save
    if (
      finalGenres.length > 0 ||
      popularity !== undefined ||
      followers !== undefined
    ) {
      logger(
        'WARN',
        `[Backfill] 💾 Updating database for "${artistName}" (${spotifyArtistId}): Genres=${finalGenres.length}, Pop=${popularity}, Followers=${followers}`
      )
      await upsertArtistProfile({
        spotify_artist_id: spotifyArtistId,
        name: artistName,
        genres: finalGenres,
        popularity,
        follower_count: followers
      })
      logger(
        'WARN',
        `[Backfill] ✅ Database updated successfully for "${artistName}"`
      )
      return finalGenres.length > 0 ? finalGenres : null
    }

    logger(
      'WARN',
      `[Backfill] ❌ All strategies failed for "${artistName}" (${spotifyArtistId}) - no data to update`
    )
    return null
  } catch (error) {
    logger(
      'WARN',
      `Exception in backfillArtistGenres for ${spotifyArtistId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return null
  }
}

/**
 * Backfill track genre from artist (checks artists table only, no API call)
 */
export async function backfillTrackGenreFromArtist(
  spotifyTrackId: string,
  artistName: string
): Promise<string | null> {
  try {
    // Look up artist in artists table - use .maybeSingle() to avoid throwing on no match
    const { data: artist, error } = await queryWithRetry<{
      genres: string[] | null
    }>(
      supabase
        .from('artists')
        .select('genres')
        .ilike('name', artistName)
        .not('genres', 'is', null)
        .limit(1)
        .maybeSingle(),
      undefined,
      'Get artist genres for track backfill'
    )

    if (error || !artist?.genres || artist.genres.length === 0) {
      return null
    }

    const genre = artist.genres[0]

    // Atomic update: only update if genre is still null (prevents race conditions)
    const { error: updateError } = await queryWithRetry(
      supabase
        .from('tracks')
        .update({ genre })
        .eq('spotify_track_id', spotifyTrackId)
        .is('genre', null),
      undefined,
      'Update track genre from artist (atomic)'
    )

    if (updateError) {
      // If update failed, track might have been updated by another process
      // Check if it now has a genre
      const { data: updatedTrack } = await queryWithRetry<{
        genre: string | null
      }>(
        supabase
          .from('tracks')
          .select('genre')
          .eq('spotify_track_id', spotifyTrackId)
          .maybeSingle(),
        undefined,
        'Check track genre after failed update'
      )
      return updatedTrack?.genre ?? null
    }

    return genre
  } catch (error) {
    logger(
      'WARN',
      `Exception in backfillTrackGenreFromArtist for track ${spotifyTrackId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return null
  }
}

/**
 * Backfill track genre (full backfill with API calls and fallbacks)
 */
export async function backfillTrackGenre(
  spotifyTrackId: string,
  artistName: string,
  releaseYear: number | null = null,
  popularity: number | null = null,
  token?: string
): Promise<string | null> {
  try {
    // Check if track already has genre - use maybeSingle() to avoid throwing
    const { data: track } = await queryWithRetry<{ genre: string | null }>(
      supabase
        .from('tracks')
        .select('genre')
        .eq('spotify_track_id', spotifyTrackId)
        .maybeSingle(),
      undefined,
      'Check track genre before backfill'
    )

    if (track?.genre) {
      return track.genre // Already has genre
    }

    // First try: Check artists table
    let genre = await backfillTrackGenreFromArtist(spotifyTrackId, artistName)
    if (genre) {
      return genre
    }

    // Second try: Look up artist by name to get Spotify ID - use maybeSingle() to avoid throwing
    const { data: artist } = await queryWithRetry<{
      spotify_artist_id: string
    }>(
      supabase
        .from('artists')
        .select('spotify_artist_id')
        .ilike('name', artistName)
        .limit(1)
        .maybeSingle(),
      undefined,
      'Get artist ID for track backfill'
    )

    const spotifyArtistId: string | null = artist?.spotify_artist_id || null

    // If artist not found, try to search Spotify (but this is expensive, so skip for now)
    // We'll rely on the artist being in the database from other operations

    if (spotifyArtistId) {
      // Backfill artist genres (which will try all fallbacks)
      const genres = await backfillArtistGenres(
        spotifyArtistId,
        artistName,
        token
      )

      if (genres && genres.length > 0) {
        genre = genres[0]

        // Atomic update: only update if genre is still null (prevents race conditions)
        const { error: updateError } = await queryWithRetry(
          supabase
            .from('tracks')
            .update({ genre })
            .eq('spotify_track_id', spotifyTrackId)
            .is('genre', null),
          undefined,
          'Update track genre from backfilled artist (atomic)'
        )

        if (!updateError) {
          return genre
        }
        // If update failed, another process may have updated it - check current state
        const { data: updatedTrack } = await queryWithRetry<{
          genre: string | null
        }>(
          supabase
            .from('tracks')
            .select('genre')
            .eq('spotify_track_id', spotifyTrackId)
            .maybeSingle(),
          undefined,
          'Check track genre after failed update'
        )
        return updatedTrack?.genre ?? null
      }
    }

    // Final fallback: Metadata inference - REMOVED
    // genre = inferGenreFromMetadata(releaseYear, popularity)
    // if (genre) { ... } (REMOVED)

    return null
  } catch (error) {
    logger(
      'WARN',
      `Exception in backfillTrackGenre for track ${spotifyTrackId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return null
  }
}

/**
 * Safe wrapper for backfillTrackGenre with deduplication and error handling
 * Prevents duplicate backfill attempts and ensures errors don't cause unhandled promise rejections
 */
export async function safeBackfillTrackGenre(
  spotifyTrackId: string,
  artistName: string,
  releaseYear: number | null = null,
  popularity: number | null = null,
  token?: string
): Promise<void> {
  const key = `track:${spotifyTrackId}`

  // Check completion cache first
  const lastCompleted = completedBackfills.get(key)
  if (lastCompleted) {
    const timeSinceCompletion = Date.now() - lastCompleted
    if (timeSinceCompletion < COMPLETION_CACHE_TTL_MS) {
      // Recently completed, skip
      return
    }
    // TTL expired, remove from cache
    completedBackfills.delete(key)
  }

  // Deduplication: Skip if already in progress
  if (ongoingTrackBackfills.has(key)) {
    return
  }

  // Concurrency check
  if (activeBackfills >= MAX_CONCURRENT_BACKFILLS) {
    return
  }

  ongoingTrackBackfills.add(key)
  activeBackfills++
  metrics.trackAttempts++

  try {
    const result = await backfillTrackGenre(
      spotifyTrackId,
      artistName,
      releaseYear,
      popularity,
      token
    )
    if (result) {
      metrics.trackSuccesses++
      // Mark as completed
      completedBackfills.set(key, Date.now())
    } else {
      metrics.trackFailures++
    }
  } catch (error) {
    if ((error as any)?.status === 429) {
      // Silent return on rate limit
      return
    }
    metrics.trackFailures++
    logger(
      'ERROR',
      `Unhandled error in safeBackfillTrackGenre for track ${spotifyTrackId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
  } finally {
    activeBackfills--
    ongoingTrackBackfills.delete(key)
  }
}

/**
 * Safe wrapper for backfillArtistGenres with deduplication and error handling
 * Prevents duplicate backfill attempts and ensures errors don't cause unhandled promise rejections
 */
export async function safeBackfillArtistGenres(
  spotifyArtistId: string,
  artistName: string,
  token?: string
): Promise<void> {
  const key = `artist:${spotifyArtistId}`

  // Check completion cache first
  const lastCompleted = completedBackfills.get(key)
  if (lastCompleted) {
    const timeSinceCompletion = Date.now() - lastCompleted
    if (timeSinceCompletion < COMPLETION_CACHE_TTL_MS) {
      // Recently completed, skip
      return
    }
    // TTL expired, remove from cache
    completedBackfills.delete(key)
  }

  // Deduplication: Skip if already in progress
  if (ongoingArtistBackfills.has(key)) {
    logger(
      'INFO',
      `[Backfill] Skipping duplicate backfill attempt for "${artistName}" (${spotifyArtistId})`
    )
    return
  }

  // Concurrency check
  if (activeBackfills >= MAX_CONCURRENT_BACKFILLS) {
    logger(
      'INFO',
      `[Backfill] Skipping backfill for "${artistName}" - too many active backfills`
    )
    return
  }

  ongoingArtistBackfills.add(key)
  activeBackfills++
  metrics.artistAttempts++

  // Use WARN level so it shows up in UI logs
  logger(
    'WARN',
    `[Backfill] Starting genre backfill for "${artistName}" (${spotifyArtistId}) - attempt #${metrics.artistAttempts}`
  )

  try {
    const result = await backfillArtistGenres(
      spotifyArtistId,
      artistName,
      token
    )
    if (result && result.length > 0) {
      metrics.artistSuccesses++
      // Mark as completed
      completedBackfills.set(key, Date.now())
      logger(
        'WARN',
        `[Backfill] ✅ SUCCESS: Found genres for "${artistName}": ${result.join(', ')}`
      )
      console.log(
        `[GenreBackfill] ✅ SUCCESS: Found genres for "${artistName}": ${result.join(', ')}`
      )
    } else {
      metrics.artistFailures++
      logger(
        'WARN',
        `[Backfill] ❌ FAILED: No genres found for "${artistName}" after all strategies (attempts: ${metrics.artistAttempts}, successes: ${metrics.artistSuccesses}, failures: ${metrics.artistFailures})`
      )
      console.log(
        `[GenreBackfill] ❌ FAILED: No genres found for "${artistName}" after all strategies`
      )
    }
  } catch (error) {
    // Graceful handling of rate limits
    if ((error as any)?.status === 429) {
      logger(
        'WARN',
        `[Backfill] Rate limit hit for "${artistName}". Aborting backfill.`
      )
      return
    }

    metrics.artistFailures++
    logger(
      'ERROR',
      `[Backfill] ❌ ERROR: Unhandled error in safeBackfillArtistGenres for artist ${spotifyArtistId} (${artistName})`,
      undefined,
      error instanceof Error ? error : undefined
    )
  } finally {
    activeBackfills--
    ongoingArtistBackfills.delete(key)
  }
}
