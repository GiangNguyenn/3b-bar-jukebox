/**
 * Database cache layer for DGS engine
 * Provides DB-first lookups for artist data to minimize Spotify API calls
 *
 * Cache hierarchy:
 * 1. In-memory cache (handled by caller)
 * 2. Database cache (this module)
 * 3. Spotify API (fallback)
 */

import { supabase, queryWithRetry } from '@/lib/supabase'
import { sendApiRequest } from '@/shared/api'
import type { SpotifyArtist, TrackDetails } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'
import { safeBackfillArtistGenres, backfillArtistGenres } from './genreBackfill'
import type { ApiStatisticsTracker } from './apiStatisticsTracker'

const logger = createModuleLogger('DgsCache')

const CACHE_TTL_DAYS = 100 // Refresh if older than 100 days

export interface CachedArtistProfile {
  spotify_artist_id: string
  name: string
  genres: string[]
  popularity: number | null
  follower_count: number | null
  cached_at: string
}

export interface CachedRelationship {
  source_spotify_artist_id: string
  related_spotify_artist_id: string
  cached_at: string
}

export interface CachedTopTrack {
  spotify_artist_id: string
  spotify_track_id: string
  rank: number
  cached_at: string
}

/**
 * Check if cached data is still fresh (< 100 days old)
 */
function isCacheFresh(cachedAt: string): boolean {
  const cacheDate = new Date(cachedAt)
  const now = new Date()
  const ageInDays =
    (now.getTime() - cacheDate.getTime()) / (1000 * 60 * 60 * 24)
  return ageInDays < CACHE_TTL_DAYS
}

/**
 * Get cached artist profile from database
 * Returns null if not found or cache is stale
 */
export async function getCachedArtistProfile(
  spotifyArtistId: string
): Promise<CachedArtistProfile | null> {
  try {
    const { data, error } = await queryWithRetry<CachedArtistProfile>(
      supabase
        .from('artists')
        .select(
          'spotify_artist_id, name, genres, popularity, follower_count, cached_at'
        )
        .eq('spotify_artist_id', spotifyArtistId)
        .single(),
      undefined,
      `Get cached artist profile: ${spotifyArtistId}`
    )

    if (error || !data) {
      return null
    }

    // Check if cache is fresh
    if (!isCacheFresh(data.cached_at)) {
      logger('INFO', `Stale cache for artist ${spotifyArtistId}, will refresh`)
      return null
    }

    // If genres are missing or empty, queue async backfill (non-blocking)
    if (!data.genres || data.genres.length === 0) {
      void safeBackfillArtistGenres(data.spotify_artist_id, data.name)
    }

    return data
  } catch (error) {
    logger(
      'WARN',
      `Failed to get cached artist profile for ${spotifyArtistId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return null
  }
}

/**
 * Get cached related artists from database
 * Returns empty array if not found or cache is stale
 */
export async function getCachedRelatedArtists(
  spotifyArtistId: string
): Promise<string[]> {
  try {
    type RelationshipSelect = {
      related_spotify_artist_id: string
      cached_at: string | null
    }
    const { data, error } = await queryWithRetry<RelationshipSelect[]>(
      supabase
        .from('artist_relationships')
        .select('related_spotify_artist_id, cached_at')
        .eq('source_spotify_artist_id', spotifyArtistId),
      undefined,
      `Get cached related artists: ${spotifyArtistId}`
    )

    if (error || !data || data.length === 0) {
      return []
    }

    // Filter out stale relationships instead of rejecting all
    // This prevents throwing away good cache data when only some relationships are stale
    const freshRelationships = data.filter(
      (rel) => rel.cached_at && isCacheFresh(rel.cached_at)
    )

    if (freshRelationships.length === 0) {
      logger(
        'INFO',
        `All relationships stale for artist ${spotifyArtistId}, will refresh`
      )
      return []
    }

    if (freshRelationships.length < data.length) {
      const staleCount = data.length - freshRelationships.length
      logger(
        'INFO',
        `Filtered out ${staleCount} stale relationships for artist ${spotifyArtistId}, returning ${freshRelationships.length} fresh relationships`
      )
    }

    return freshRelationships.map((rel) => rel.related_spotify_artist_id)
  } catch (error) {
    logger(
      'WARN',
      `Failed to get cached related artists for ${spotifyArtistId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return []
  }
}

/**
 * Get cached top tracks from database
 * Returns empty array if not found or cache is stale
 */
export async function getCachedTopTracks(
  spotifyArtistId: string
): Promise<string[]> {
  try {
    type TopTrackSelect = {
      spotify_track_id: string
      rank: number
      cached_at: string | null
    }
    const { data, error } = await queryWithRetry<TopTrackSelect[]>(
      supabase
        .from('artist_top_tracks')
        .select('spotify_track_id, rank, cached_at')
        .eq('spotify_artist_id', spotifyArtistId)
        .order('rank', { ascending: true }),
      undefined,
      `Get cached top tracks: ${spotifyArtistId}`
    )

    if (error || !data || data.length === 0) {
      return []
    }

    // Check if cache is stale
    const hasStaleData = data.some(
      (track) => !track.cached_at || !isCacheFresh(track.cached_at)
    )
    if (hasStaleData) {
      logger(
        'INFO',
        `Stale top tracks for artist ${spotifyArtistId}, will refresh`
      )
      return []
    }

    return data.map((track) => track.spotify_track_id)
  } catch (error) {
    logger(
      'WARN',
      `Failed to get cached top tracks for ${spotifyArtistId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return []
  }
}

/**
 * Batch get artist relationships from database
 * Returns a bidirectional map for O(1) relationship lookups during scoring
 */
export async function batchGetArtistRelationships(
  spotifyArtistIds: string[]
): Promise<Map<string, Set<string>>> {
  const relationshipMap = new Map<string, Set<string>>()

  if (spotifyArtistIds.length === 0) return relationshipMap

  try {
    type RelationshipSelect = {
      source_spotify_artist_id: string
      related_spotify_artist_id: string
      cached_at: string | null
    }
    const { data, error } = await queryWithRetry<RelationshipSelect[]>(
      supabase
        .from('artist_relationships')
        .select(
          'source_spotify_artist_id, related_spotify_artist_id, cached_at'
        )
        .or(
          `source_spotify_artist_id.in.(${spotifyArtistIds.join(',')}),` +
          `related_spotify_artist_id.in.(${spotifyArtistIds.join(',')})`
        ),
      undefined,
      `Batch get artist relationships: ${spotifyArtistIds.length} artists`
    )

    if (error || !data) {
      logger(
        'WARN',
        'Failed to batch get relationships',
        undefined,
        error as Error | undefined
      )
      return relationshipMap
    }

    // Build bidirectional map
    for (const rel of data) {
      if (!rel.cached_at || !isCacheFresh(rel.cached_at)) continue

      // Forward: source -> related
      if (!relationshipMap.has(rel.source_spotify_artist_id)) {
        relationshipMap.set(rel.source_spotify_artist_id, new Set())
      }
      relationshipMap
        .get(rel.source_spotify_artist_id)!
        .add(rel.related_spotify_artist_id)

      // Reverse: related -> source (for bidirectional lookup)
      if (!relationshipMap.has(rel.related_spotify_artist_id)) {
        relationshipMap.set(rel.related_spotify_artist_id, new Set())
      }
      relationshipMap
        .get(rel.related_spotify_artist_id)!
        .add(rel.source_spotify_artist_id)
    }

    logger(
      'INFO',
      `Batched ${data.length} relationships for ${spotifyArtistIds.length} artists`
    )
    return relationshipMap
  } catch (error) {
    logger(
      'WARN',
      'Exception batch getting relationships',
      undefined,
      error instanceof Error ? error : undefined
    )
    return relationshipMap
  }
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

    const { error } = await supabase
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
 * Save related artist relationships to database cache
 */
export async function upsertRelatedArtists(
  sourceArtistId: string,
  relatedArtistIds: string[]
): Promise<void> {
  try {
    if (relatedArtistIds.length === 0) {
      return
    }

    const relationships = relatedArtistIds.map((relatedId) => ({
      source_spotify_artist_id: sourceArtistId,
      related_spotify_artist_id: relatedId,
      cached_at: new Date().toISOString()
    }))

    const { error } = await supabase
      .from('artist_relationships')
      .upsert(relationships, {
        onConflict: 'source_spotify_artist_id,related_spotify_artist_id'
      })

    if (error) {
      logger(
        'WARN',
        `Failed to upsert ${relatedArtistIds.length} relationships for ${sourceArtistId}`,
        undefined,
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception upserting related artists`,
      undefined,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Save top tracks to database cache
 */
export async function upsertTopTracks(
  artistId: string,
  trackIds: string[]
): Promise<void> {
  try {
    if (trackIds.length === 0) {
      return
    }

    const topTracks = trackIds.slice(0, 10).map((trackId, index) => ({
      spotify_artist_id: artistId,
      spotify_track_id: trackId,
      rank: index + 1,
      cached_at: new Date().toISOString()
    }))

    const { error } = await supabase
      .from('artist_top_tracks')
      .upsert(topTracks, { onConflict: 'spotify_artist_id,spotify_track_id' })

    if (error) {
      logger(
        'WARN',
        `Failed to upsert top tracks for ${artistId}`,
        undefined,
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception upserting top tracks`,
      undefined,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Get artist profile with DB cache fallback
 * Checks DB first, fetches from Spotify if missing/stale, then caches result
 */
export async function getArtistProfileWithCache(
  spotifyArtistId: string,
  token: string
): Promise<{
  id: string
  name: string
  genres: string[]
  popularity?: number
  followers?: { total: number }
} | null> {
  // Validate artist ID before making API calls
  if (!spotifyArtistId || spotifyArtistId.trim() === '') {
    logger('WARN', `[DGS Cache] Invalid or empty artist ID provided`)
    return null
  }

  // Check DB cache first
  const cached = await getCachedArtistProfile(spotifyArtistId)
  if (cached) {
    logger('INFO', `DB cache hit for artist ${cached.name}`)
    if (!cached.genres || cached.genres.length === 0) {
      void safeBackfillArtistGenres(
        cached.spotify_artist_id,
        cached.name,
        token
      )
    }
    return {
      id: cached.spotify_artist_id,
      name: cached.name,
      genres: cached.genres || [],
      popularity: cached.popularity ?? undefined,
      followers: cached.follower_count
        ? { total: cached.follower_count }
        : undefined
    }
  }

  // Cache miss - fetch from Spotify
  try {
    const artistData = await sendApiRequest<{
      id: string
      name: string
      genres: string[]
      popularity?: number
      followers?: { total: number }
    }>({
      path: `/artists/${spotifyArtistId}`,
      method: 'GET',
      token
    })

    // Save to cache (fire-and-forget)
    void upsertArtistProfile({
      spotify_artist_id: artistData.id,
      name: artistData.name,
      genres: artistData.genres || [],
      popularity: artistData.popularity,
      follower_count: artistData.followers?.total
    })

    // If Spotify returned no genres, queue fallback backfill
    if (!artistData.genres || artistData.genres.length === 0) {
      void backfillArtistGenres(artistData.id, artistData.name, token)
    }

    return artistData
  } catch (error) {
    logger(
      'WARN',
      `Failed to fetch artist profile from Spotify: ${spotifyArtistId}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return null
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
    for (const artistId of Array.from(cachedMap.keys())) {
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

/**
 * Get related artists with DB cache fallback
 */
export async function getRelatedArtistsWithCache(
  spotifyArtistId: string,
  fetchFromSpotify: () => Promise<SpotifyArtist[]>
): Promise<SpotifyArtist[]> {
  // Check DB cache first
  const cachedIds = await getCachedRelatedArtists(spotifyArtistId)

  if (cachedIds.length > 0) {
    logger(
      'INFO',
      `DB cache hit: ${cachedIds.length} related artists for ${spotifyArtistId}`
    )
    return cachedIds.map((id) => ({ id, name: '' })) // Name will be fetched separately if needed
  }

  // Cache miss - fetch from Spotify
  logger(
    'INFO',
    `DB cache miss: fetching related artists from Spotify for ${spotifyArtistId}`
  )
  const relatedArtists = await fetchFromSpotify()

  // Save to cache (fire-and-forget)
  void upsertRelatedArtists(
    spotifyArtistId,
    relatedArtists.map((a) => a.id).filter(Boolean)
  )

  return relatedArtists
}

/**
 * Get top tracks with DB cache fallback
 * Returns Spotify track IDs only (caller can fetch full track details if needed)
 */
export async function getTopTracksWithCache(
  spotifyArtistId: string,
  fetchFromSpotify: () => Promise<TrackDetails[]>
): Promise<string[]> {
  // Check DB cache first
  const cachedTrackIds = await getCachedTopTracks(spotifyArtistId)

  if (cachedTrackIds.length > 0) {
    logger(
      'INFO',
      `DB cache hit: ${cachedTrackIds.length} top tracks for ${spotifyArtistId}`
    )
    return cachedTrackIds
  }

  // Cache miss - fetch from Spotify
  logger(
    'INFO',
    `DB cache miss: fetching top tracks from Spotify for ${spotifyArtistId}`
  )
  const topTracks = await fetchFromSpotify()

  // Save to cache (fire-and-forget)
  void upsertTopTracks(
    spotifyArtistId,
    topTracks.map((t) => t.id).filter(Boolean)
  )

  return topTracks.map((t) => t.id)
}

/**
 * Batch get top tracks from database for multiple artists
 * Returns a map of artist ID -> track details array
 */
export async function batchGetTopTracksFromDb(
  spotifyArtistIds: string[],
  statisticsTracker?: ApiStatisticsTracker
): Promise<Map<string, TrackDetails[]>> {
  const result = new Map<string, TrackDetails[]>()

  if (spotifyArtistIds.length === 0) return result

  try {
    // Query all top tracks for all artists in one query
    const tStart = Date.now()
    const { data, error } = await queryWithRetry(
      supabase
        .from('artist_top_tracks')
        .select('spotify_artist_id, spotify_track_id, rank, cached_at')
        .in('spotify_artist_id', spotifyArtistIds)
        .order('rank', { ascending: true }),
      undefined,
      'Batch get top tracks from DB'
    )
    const tEnd = Date.now()
    statisticsTracker?.recordDbQuery('batchGetTopTracks', tEnd - tStart)

    if (error || !data) return result

    // Check cache freshness and group by artist
    const trackIdsByArtist = new Map<string, string[]>()

    for (const row of data) {
      if (!row.cached_at || !isCacheFresh(row.cached_at)) continue // Skip stale data

      if (!trackIdsByArtist.has(row.spotify_artist_id)) {
        trackIdsByArtist.set(row.spotify_artist_id, [])
      }
      trackIdsByArtist.get(row.spotify_artist_id)!.push(row.spotify_track_id)
    }

    // Now fetch full track details from tracks table
    const allTrackIds = Array.from(
      new Set(Array.from(trackIdsByArtist.values()).flat())
    )

    if (allTrackIds.length > 0) {
      // Record track details requests
      allTrackIds.forEach(() => {
        statisticsTracker?.recordRequest('trackDetails')
      })

      const trackDetailsMap = await batchGetTrackDetailsFromDb(
        allTrackIds,
        statisticsTracker
      )

      // Reconstruct artist -> tracks mapping
      trackIdsByArtist.forEach((trackIds, artistId) => {
        const tracks = trackIds
          .map((id) => {
            const track = trackDetailsMap.get(id)
            if (!track) return undefined
            // INJECT ARTIST ID: The tracks table does not store spotify_artist_id,
            // so we must inject it here using the artistId we started with.
            if (
              track.artists &&
              track.artists.length > 0 &&
              !track.artists[0].id
            ) {
              track.artists[0].id = artistId
            }
            return track
          })
          .filter((t): t is TrackDetails => t !== undefined)
        if (tracks.length > 0) {
          result.set(artistId, tracks)
        }
      })
    }

    logger(
      'INFO',
      `Batch DB cache: ${result.size}/${spotifyArtistIds.length} artists had cached top tracks`
    )
    return result
  } catch (error) {
    logger(
      'WARN',
      'Failed to batch get top tracks from DB',
      undefined,
      error instanceof Error ? error : undefined
    )
    return result
  }
}

/**
 * Batch get track details from database
 * Returns a map of track ID -> track details
 */
export async function batchGetTrackDetailsFromDb(
  spotifyTrackIds: string[],
  statisticsTracker?: ApiStatisticsTracker
): Promise<Map<string, TrackDetails>> {
  const result = new Map<string, TrackDetails>()

  if (spotifyTrackIds.length === 0) return result

  try {
    const tStart = Date.now()
    const { data, error } = await queryWithRetry(
      supabase
        .from('tracks')
        .select('*')
        .in('spotify_track_id', spotifyTrackIds),
      undefined,
      'Batch get track details from DB'
    )
    const tEnd = Date.now()
    statisticsTracker?.recordDbQuery('batchGetTrackDetails', tEnd - tStart)

    if (error || !data) return result

    // Track cache hits for all tracks found in database
    if (statisticsTracker) {
      data.forEach(() => {
        statisticsTracker.recordCacheHit('trackDetails', 'database')
      })
    }

    data.forEach((row) => {
      // Skip tracks with missing or empty critical metadata
      const trackName = row.name?.trim()
      const trackId = row.spotify_track_id?.trim()
      const artistName = row.artist?.trim()

      if (!trackName || !trackId || !artistName) {
        logger(
          'WARN',
          `Skipping track with missing/empty metadata from DB: name="${row.name ?? 'missing'}", id="${row.spotify_track_id ?? 'missing'}", artist="${row.artist ?? 'missing'}"`,
          'batchGetTrackDetailsFromDb'
        )
        return
      }

      const track: TrackDetails = {
        id: row.spotify_track_id,
        uri: `spotify:track:${row.spotify_track_id}`,
        name: row.name,
        duration_ms: row.duration_ms,
        popularity: row.popularity,
        preview_url: null,
        is_playable: true,
        explicit: false,
        album: {
          name: row.album,
          images: [],
          release_date: ''
        },
        artists: [{ name: row.artist, id: '' }],
        external_urls: row.spotify_url
          ? { spotify: row.spotify_url }
          : undefined,
        genre: row.genre ?? undefined
      }
      result.set(row.spotify_track_id, track)
    })

    logger(
      'INFO',
      `Fetched ${result.size}/${spotifyTrackIds.length} track details from DB`
    )
    return result
  } catch (error) {
    logger(
      'WARN',
      'Failed to batch get track details',
      undefined,
      error instanceof Error ? error : undefined
    )
    return result
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

    const { error } = await supabase
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
 * Save track details to database cache
 */
export async function upsertTrackDetails(
  tracks: TrackDetails[]
): Promise<void> {
  try {
    if (tracks.length === 0) {
      return
    }

    const records = tracks.map((track) => {
      // Only include fields with valid data
      const record: any = {
        spotify_track_id: track.id,
        name: track.name,
        duration_ms: track.duration_ms,
        popularity: track.popularity,
        artist: track.artists[0]?.name,
        album: track.album?.name,
        cached_at: new Date().toISOString()
      }

      if (track.external_urls?.spotify) {
        record.spotify_url = track.external_urls.spotify
      }

      if (track.genre) {
        record.genre = track.genre
      }

      return record
    })

    const { error } = await supabase
      .from('tracks')
      .upsert(records, { onConflict: 'spotify_track_id' })

    if (error) {
      logger(
        'WARN',
        `Failed to upsert ${tracks.length} track details`,
        undefined,
        error as Error
      )
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception upserting track details`,
      undefined,
      error instanceof Error ? error : undefined
    )
  }
}
