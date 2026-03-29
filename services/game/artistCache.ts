/**
 * Artist profile caching layer
 * Extracted from dgsCache.ts — provides DB-first lookups for artist data
 * to minimize Spotify API calls.
 *
 * Used by genreBackfill.ts, genreSimilarity.ts, and app/api/tracks/upsert/route.ts
 */

import { supabase, queryWithRetry } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendApiRequest } from '@/shared/api'
import { createModuleLogger } from '@/shared/utils/logger'
import { backfillArtistGenres } from './genreBackfill'
import { ApiStatisticsTracker } from '@/shared/apiCallCategorizer'

// Re-export for consumers that previously imported via dgsCache
export { safeBackfillArtistGenres } from './genreBackfill'
export type { ApiStatisticsTracker }

const logger = createModuleLogger('ArtistCache')

const CACHE_TTL_DAYS = 100 // Refresh if older than 100 days

export interface CachedArtistProfile {
  spotify_artist_id: string
  name: string
  genres: string[]
  popularity: number | null
  follower_count: number | null
  cached_at: string
}

/**
 * Check if cached data is still fresh (< CACHE_TTL_DAYS days old)
 */
function isCacheFresh(cachedAt: string): boolean {
  const cacheDate = new Date(cachedAt)
  const now = new Date()
  const ageInDays =
    (now.getTime() - cacheDate.getTime()) / (1000 * 60 * 60 * 24)
  return ageInDays < CACHE_TTL_DAYS
}

/**
 * Save artist profile to database cache
 */
export async function upsertArtistProfile(artistData: {
  spotify_artist_id: string
  name: string
  genres: string[]
  popularity?: number
  follower_count?: number
}): Promise<void> {
  try {
    // Only include fields with valid data - never overwrite with null
    const record: any = {
      spotify_artist_id: artistData.spotify_artist_id,
      name: artistData.name,
      genres: artistData.genres,
      cached_at: new Date().toISOString()
    }

    // Only set if we have valid data
    if (artistData.popularity !== undefined && artistData.popularity !== null) {
      record.popularity = artistData.popularity
    }
    if (
      artistData.follower_count !== undefined &&
      artistData.follower_count !== null
    ) {
      record.follower_count = artistData.follower_count
    }

    const { error } = await supabaseAdmin
      .from('artists')
      .upsert(record, { onConflict: 'spotify_artist_id' })

    if (error) {
      logger(
        'WARN',
        `Failed to upsert artist profile for ${artistData.spotify_artist_id}`,
        undefined,
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception upserting artist profile`,
      undefined,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Batch upsert multiple artist profiles
 * Used after fetching a batch from Spotify API
 */
export async function batchUpsertArtistProfiles(
  artists: Array<{
    id: string
    name: string
    genres: string[]
    popularity?: number
    followers?: { total: number }
  }>
): Promise<void> {
  try {
    if (artists.length === 0) {
      return
    }

    const records = artists.map((artist) => {
      // Only include fields with valid data - never overwrite with null
      const record: any = {
        spotify_artist_id: artist.id,
        name: artist.name,
        genres: artist.genres || [],
        cached_at: new Date().toISOString()
      }

      // Only set if we have valid data
      if (artist.popularity !== undefined && artist.popularity !== null) {
        record.popularity = artist.popularity
      }
      if (
        artist.followers?.total !== undefined &&
        artist.followers?.total !== null
      ) {
        record.follower_count = artist.followers.total
      }

      return record
    })

    const { error } = await supabaseAdmin
      .from('artists')
      .upsert(records, { onConflict: 'spotify_artist_id' })

    if (error) {
      logger(
        'WARN',
        `Failed to batch upsert ${artists.length} artist profiles`,
        undefined,
        error as Error
      )
    } else {
      logger('INFO', `Cached ${artists.length} artist profiles to database`)
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception batch upserting artists`,
      undefined,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Batch get artist profiles with DB cache fallback
 * Returns map of artistId -> profile, only fetches missing ones from Spotify
 */
export async function batchGetArtistProfilesWithCache(
  spotifyArtistIds: string[],
  token: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<
  Map<
    string,
    {
      id: string
      name: string
      genres: string[]
      popularity?: number
      followers?: number
    }
  >
> {
  const result = new Map<
    string,
    {
      id: string
      name: string
      genres: string[]
      popularity?: number
      followers?: number
    }
  >()

  if (spotifyArtistIds.length === 0) {
    return result
  }

  // Note: Requests should be recorded by the caller before calling this function
  // This function only tracks cache hits and API items

  // Check DB cache for all IDs
  type ArtistProfileSelect = {
    spotify_artist_id: string
    name: string
    genres: string[] | null
    popularity: number | null
    follower_count: number | null
    cached_at: string | null
  }
  const tStart = Date.now()
  const { data: cachedProfiles } = await queryWithRetry<ArtistProfileSelect[]>(
    supabase
      .from('artists')
      .select(
        'spotify_artist_id, name, genres, popularity, follower_count, cached_at'
      )
      .in('spotify_artist_id', spotifyArtistIds),
    undefined,
    `Batch get cached artists (${spotifyArtistIds.length} IDs)`
  )
  const tEnd = Date.now()
  statisticsTracker?.recordDbQuery('batchGetArtistProfiles', tEnd - tStart)

  const cachedMap = new Map<string, CachedArtistProfile>()
  const missingIds: string[] = []

  // Process cached results
  if (cachedProfiles) {
    for (const profile of cachedProfiles) {
      if (!profile.cached_at || !isCacheFresh(profile.cached_at)) {
        continue
      }
      // If genres are missing or empty, treat as cache miss to force immediate refresh
      // This is critical for scoring - we can't use an artist with no genres
      if (!profile.genres || profile.genres.length === 0) {
        logger(
          'WARN',
          `[Cache Invalidation] Artist "${profile.name}" (${profile.spotify_artist_id}) has empty genres in DB. Forcing Spotify refresh.`
        )
        continue // Skip adding to cachedMap, so it gets added to missingIds
      }

      cachedMap.set(profile.spotify_artist_id, {
        spotify_artist_id: profile.spotify_artist_id,
        name: profile.name,
        genres: profile.genres || [],
        popularity: profile.popularity,
        follower_count: profile.follower_count,
        cached_at: profile.cached_at
      })
      result.set(profile.spotify_artist_id, {
        id: profile.spotify_artist_id,
        name: profile.name,
        genres: profile.genres || [],
        popularity: profile.popularity ?? undefined,
        followers: profile.follower_count ?? undefined
      })
    }
  }

  // Track cache hits
  if (statisticsTracker) {
    for (const _artistId of Array.from(cachedMap.keys())) {
      statisticsTracker.recordCacheHit('artistProfiles', 'database')
    }
  }

  // Find missing IDs
  for (const id of spotifyArtistIds) {
    if (!cachedMap.has(id)) {
      missingIds.push(id)
    }
  }

  if (missingIds.length === 0) {
    logger('INFO', `DB cache hit for all ${spotifyArtistIds.length} artists`)
    return result
  }

  logger(
    'INFO',
    `DB cache: ${cachedMap.size} hits, ${missingIds.length} misses (will make API calls for ${missingIds.length} artists)`
  )

  // Fetch missing artists from Spotify in batches of 50
  const chunks: string[][] = []
  const chunkSize = 50
  for (let i = 0; i < missingIds.length; i += chunkSize) {
    chunks.push(missingIds.slice(i, i + chunkSize))
  }

  for (const chunk of chunks) {
    try {
      const idsParam = chunk.join(',')

      // API call tracking is handled automatically by sendApiRequest

      const response = await sendApiRequest<{
        artists: Array<{
          id: string
          name: string
          genres: string[]
          popularity?: number
          followers?: { total: number }
        }>
      }>({
        path: `/artists?ids=${idsParam}`,
        method: 'GET',
        token,
        statisticsTracker
      })

      if (response.artists) {
        // Track items returned from Spotify
        if (statisticsTracker) {
          // We count items that were actually returned
          const validArtists = response.artists.filter((a) => !!a).length
          statisticsTracker.recordFromSpotify('artistProfiles', validArtists)
          logger(
            'INFO',
            `API batch returned ${validArtists} artist profiles (chunk of ${chunk.length})`,
            'batchGetArtistProfilesWithCache'
          )
        }

        for (const artist of response.artists) {
          if (artist) {
            result.set(artist.id, {
              id: artist.id,
              name: artist.name,
              genres: artist.genres || [],
              popularity: artist.popularity,
              followers: artist.followers?.total
            })

            // Save to cache (fire-and-forget)
            void upsertArtistProfile({
              spotify_artist_id: artist.id,
              name: artist.name,
              genres: artist.genres || [],
              popularity: artist.popularity,
              follower_count: artist.followers?.total
            })

            // If Spotify returned no genres, queue fallback backfill
            if (!artist.genres || artist.genres.length === 0) {
              void backfillArtistGenres(artist.id, artist.name, token)
            }
          }
        }
      }
    } catch (error) {
      logger(
        'WARN',
        `Failed to fetch artist batch from Spotify`,
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  return result
}
