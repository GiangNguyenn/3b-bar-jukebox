/**
 * Lazy track metadata backfilling utilities
 * Automatically updates tracks with missing release dates and popularity when encountered
 */

import { supabase, queryWithRetry } from '@/lib/supabase'
import { sendApiRequest } from '@/shared/api'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('TrackBackfill')

// Deduplication: Track ongoing backfill operations to prevent duplicate attempts
// Deduplication: Track ongoing backfill operations to prevent duplicate attempts
const ongoingTrackBackfills = new Set<string>()

// Rate Limiting & Caching: Track recent attempts to prevent spamming API
// Map<trackId, { timestamp: number, success: boolean }>
const recentBackfills = new Map<
  string,
  { timestamp: number; success: boolean }
>()
const BACKFILL_CACHE_TTL = 60 * 60 * 1000 // 1 hour
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// Periodic cleanup of old cache entries
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of Array.from(recentBackfills.entries())) {
    if (now - value.timestamp > BACKFILL_CACHE_TTL) {
      recentBackfills.delete(key)
    }
  }
}, CLEANUP_INTERVAL)

import { RateLimitManager } from '@/shared/api'

/**
 * Fetch track details from MusicBrainz (prioritizing original release date)
 */
export async function fetchTrackMetadataFromMusicBrainz(
  artistName: string,
  trackName: string
): Promise<{ releaseDate: string | null; genres: string[] }> {
  try {
    const query = `query=artist:${encodeURIComponent(artistName)} AND recording:${encodeURIComponent(trackName)}&fmt=json`
    logger(
      'INFO',
      `[MusicBrainz] Searching for track: "${trackName}" by "${artistName}"`
    )

    const response = await fetch(
      `https://musicbrainz.org/ws/2/recording/?${query}`,
      {
        headers: {
          'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
        }
      }
    )

    if (!response.ok) {
      logger(
        'WARN',
        `[MusicBrainz] Search failed with status ${response.status}`
      )
      return { releaseDate: null, genres: [] }
    }

    const data = (await response.json()) as {
      recordings: Array<{
        title: string
        releases?: Array<{
          date?: string
          'release-events'?: Array<{ date?: string }>
        }>
        tags?: Array<{ name: string; count: number }>
        genres?: Array<{ name: string }>
      }>
    }

    if (!data.recordings || data.recordings.length === 0) {
      logger('WARN', `[MusicBrainz] No recordings found for "${trackName}"`)
      return { releaseDate: null, genres: [] }
    }

    // Flatten all releases from all matching recordings (strict title match preferred)
    const allReleases: { date: string }[] = []
    const allTags: Set<string> = new Set()

    // Filter for exact title matches first to improve accuracy
    const exactMatches = data.recordings.filter(
      (r) => r.title.toLowerCase() === trackName.toLowerCase()
    )
    const candidates = exactMatches.length > 0 ? exactMatches : data.recordings

    candidates.forEach((recording) => {
      // Collect releases for date
      if (recording.releases) {
        recording.releases.forEach((release) => {
          if (release.date) {
            allReleases.push({ date: release.date })
          }
        })
      }
      // Collect tags/genres from MusicBrainz
      // Note: MusicBrainz Search API returns 'tags', not usually 'genres' for recordings,
      // but we check both just in case or if API evolves.
      recording.tags?.forEach((tag) => allTags.add(tag.name.toLowerCase()))
      recording.genres?.forEach((genre) =>
        allTags.add(genre.name.toLowerCase())
      )
    })

    const genres = Array.from(allTags).slice(0, 5) // Top 5 unique tags

    if (allReleases.length === 0 && genres.length === 0) {
      return { releaseDate: null, genres: [] }
    }

    // Sort by date ascending to find the earliest release
    let earliestDate: string | null = null
    if (allReleases.length > 0) {
      allReleases.sort((a, b) => {
        // Handle incomplete dates (YYYY, YYYY-MM) by treating them as earliest possible
        return a.date.localeCompare(b.date)
      })
      earliestDate = allReleases[0].date
      logger(
        'INFO',
        `[MusicBrainz] Found earliest release date for "${trackName}": ${earliestDate}`
      )
    }

    if (genres.length > 0) {
      logger(
        'INFO',
        `[MusicBrainz] Found genres for "${trackName}": ${genres.join(', ')}`
      )
    }

    return { releaseDate: earliestDate, genres }
  } catch (error) {
    logger(
      'WARN',
      `[MusicBrainz] Exception fetching track details`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return { releaseDate: null, genres: [] }
  }
}

/**
 * Backfill track details (release date, popularity)
 */
export async function backfillTrackDetails(
  spotifyTrackId: string,
  artistName: string,
  trackName: string,
  token?: string
): Promise<boolean> {
  try {
    logger(
      'INFO',
      `[Backfill] Starting track details backfill for "${trackName}" (${spotifyTrackId})`
    )

    let releaseDate: string | null = null
    let popularity: number | null = null
    let spotifyAlbumReleaseDate: string | null = null
    let genres: string[] = []

    // Step 1: MusicBrainz for Release Date (Era) and Genres
    const mbResult = await fetchTrackMetadataFromMusicBrainz(
      artistName,
      trackName
    )
    if (mbResult.releaseDate) {
      releaseDate = mbResult.releaseDate
    }
    if (mbResult.genres.length > 0) {
      genres = mbResult.genres
    }

    // Step 2: Spotify for Popularity (and fallback date)
    try {
      const trackData = await sendApiRequest<{
        popularity: number
        album: { release_date: string }
      }>({
        path: `tracks/${spotifyTrackId}`,
        method: 'GET',
        useAppToken: !token,
        token,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 2000
        }
      })

      if (trackData) {
        popularity = trackData.popularity
        spotifyAlbumReleaseDate = trackData.album?.release_date

        // If MusicBrainz failed, use Spotify date
        if (!releaseDate && spotifyAlbumReleaseDate) {
          releaseDate = spotifyAlbumReleaseDate
          logger(
            'INFO',
            `[Backfill] Used Spotify fallback date for "${trackName}": ${releaseDate}`
          )
        }
      }
    } catch (error) {
      logger(
        'WARN',
        `[Backfill] Spotify API failed for track ${spotifyTrackId}`
      )
    }

    // Step 3: Update Database
    if (releaseDate || popularity !== null || genres.length > 0) {
      const updates: {
        popularity?: number
        release_year?: number
        genre?: string
      } = {}

      if (popularity !== null) {
        updates.popularity = popularity
      }

      if (releaseDate) {
        // Extract year from YYYY-MM-DD or YYYY
        const year = parseInt(releaseDate.substring(0, 4))
        if (!isNaN(year)) {
          updates.release_year = year
        }
      }

      // Only update genre if we found some and it's missing (or just update it?)
      // For now, let's update it if we have it.
      // Note: DB genre column is single string, so we might join them or pick first.
      // Let's pick the first one implementation choice, or comma separated?
      // Existing code assumed single genre usually. Let's use first tag as genre for now.
      if (genres.length > 0) {
        // Title case the genre
        const primaryGenre = genres[0]
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
        updates.genre = primaryGenre
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await queryWithRetry(
          supabase
            .from('tracks')
            .update(updates)
            .eq('spotify_track_id', spotifyTrackId),
          undefined,
          'Backfill track details'
        )

        if (!error) {
          logger(
            'INFO',
            `[Backfill] ✅ SUCCESS: Updated track "${trackName}": Pop=${popularity}, Year=${updates.release_year}, Genre=${updates.genre}`
          )
          return true
        } else {
          logger(
            'WARN',
            `[Backfill] ❌ FAILED: Database update failed for "${trackName}"`
          )
          return false
        }
      }
    }

    logger('WARN', `[Backfill] ❌ FAILED: No data to update for "${trackName}"`)
    return false
  } catch (error) {
    logger(
      'ERROR',
      `[Backfill] ❌ ERROR: Unhandled error in backfillTrackDetails for ${spotifyTrackId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return false
  }
}

/**
 * Safe deduplication wrapper
 */
export async function safeBackfillTrackDetails(
  spotifyTrackId: string,
  artistName: string,
  trackName: string,
  token?: string
): Promise<void> {
  const key = `track-details:${spotifyTrackId}`

  if (ongoingTrackBackfills.has(key)) {
    return
  }

  // Check cache (Deduplication)
  const cached = recentBackfills.get(spotifyTrackId)
  if (cached && Date.now() - cached.timestamp < BACKFILL_CACHE_TTL) {
    // If it was a success, we don't need to do it again
    // If it failed recently, we also don't want to hammer it
    return
  }

  // Proactive Rate Limiting
  // Don't start a background backfill if we're running low on tokens
  if (!RateLimitManager.checkLimit(false)) {
    // Check without consuming first? Or consume?
    // For background tasks, we should be conservative.
    // Let's check status. If < 10 tokens (20% capacity), skip backfill to save for user actions.
    const status = RateLimitManager.status
    if (status.tokens < 10) {
      logger(
        'WARN',
        `[Backfill] Rate limit pressure (tokens=${status.tokens}), skipping backfill for ${trackName}`
      )
      return
    }
  }

  ongoingTrackBackfills.add(key)

  try {
    // DB Sanity Check: Does the track already have data?
    // This handles race conditions or if data was populated by another process
    const { data: existing } = await supabase
      .from('tracks')
      .select('release_year, popularity, genre')
      .eq('spotify_track_id', spotifyTrackId)
      .single()

    if (
      existing &&
      (existing.release_year || existing.popularity || existing.genre)
    ) {
      // We have enough data, skip API call
      recentBackfills.set(spotifyTrackId, {
        timestamp: Date.now(),
        success: true
      })
      return
    }

    // Consume a token for the actual operation (budgeting for ~1 API call)
    // Note: backfill might make 0, 1, or 2 calls (MB + Spotify).
    // We'll trust the internal throttling of sendApiRequest for the hard limits,
    // but this gate prevents queuing up 100s of them.
    const success = await backfillTrackDetails(
      spotifyTrackId,
      artistName,
      trackName,
      token
    )
    recentBackfills.set(spotifyTrackId, { timestamp: Date.now(), success })
  } finally {
    ongoingTrackBackfills.delete(key)
  }
}
