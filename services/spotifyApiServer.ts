/**
 * Server-side only Spotify API utilities
 * These methods can be safely used in API routes without importing client-side code
 */
import { sendApiRequest } from '@/shared/api'
import type { SpotifyArtist, TrackDetails } from '@/shared/types/spotify'
import { cache } from '@/shared/utils/cache'
import type { ApiStatisticsTracker } from './game/apiStatisticsTracker'
import {
  getCachedRelatedArtists,
  upsertRelatedArtists,
  getCachedTopTracks,
  upsertTopTracks
} from './game/dgsCache'
import { fetchTracksByGenreFromDb, upsertTrackDetails } from './game/dgsDb'

/**
 * Fetches artists related to the given artist (server-side only)
 * Uses hybrid approach: pre-computed graph → genre similarity (fast fallback)
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token. If provided, uses this token instead of app token.
 * @param statisticsTracker - Optional statistics tracker for performance monitoring
 */
export async function getRelatedArtistsServer(
  artistId: string,
  token?: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<SpotifyArtist[]> {
  // Validate artist ID
  if (!artistId || artistId.trim() === '') {
    throw new Error('Artist ID is required')
  }

  console.log('[spotifyApiServer] Hybrid lookup for artist:', artistId)

  // Check in-memory cache first (fastest)
  const memCacheKey = `related-artists:${artistId}`
  const memCached = cache.get<SpotifyArtist[]>(memCacheKey)
  if (memCached) {
    console.log(
      '[spotifyApiServer] Memory cache hit for related artists:',
      artistId
    )
    statisticsTracker?.recordCacheHit('relatedArtists', 'memory')
    return memCached
  }

  // TIER 1: Check pre-computed graph (instant, 0 API calls)
  const { getFromArtistGraph, saveToArtistGraph } = await import(
    './game/artistGraph'
  )
  const cachedRelations = await getFromArtistGraph(artistId, 0.3, 50, () => {
    // Track graph cache hit
    statisticsTracker?.recordCacheHit('relatedArtists', 'database')
  })

  // Lower threshold: use graph cache if we have at least 5 results
  if (cachedRelations.length >= 5) {
    console.log(
      '[spotifyApiServer] Graph cache hit:',
      cachedRelations.length,
      'artists'
    )
    statisticsTracker?.recordCacheHit('relatedArtists', 'database')
    // Store in memory cache
    cache.set(memCacheKey, cachedRelations, 10 * 60 * 1000)
    return cachedRelations
  }

  // If we have SOME graph results (even if < 5), use them to avoid timeouts
  // during cold cache periods. This prevents making expensive API calls
  // when the graph has partial data. The DGS engine will supplement with DB fallback.
  if (cachedRelations.length >= 3) {
    console.log(
      '[spotifyApiServer] Partial graph cache hit:',
      cachedRelations.length,
      'artists (returning early to avoid timeout)'
    )
    statisticsTracker?.recordCacheHit('relatedArtists', 'database')
    cache.set(memCacheKey, cachedRelations, 10 * 60 * 1000)
    return cachedRelations
  }

  // TIER 1.5: Check database cache for related artists
  // This provides a fast fallback when graph cache is empty
  const dbCachedIds = await getCachedRelatedArtists(artistId)
  if (dbCachedIds.length > 0) {
    console.log(
      '[spotifyApiServer] Database cache hit:',
      dbCachedIds.length,
      'artists'
    )
    statisticsTracker?.recordCacheHit('relatedArtists', 'database')
    // Convert to minimal SpotifyArtist objects for compatibility
    const dbArtists = dbCachedIds.map((id) => ({ id, name: '' }))
    cache.set(memCacheKey, dbArtists, 10 * 60 * 1000)
    return dbArtists
  }

  // TIER 2: Database-Only Approach (Genre Similarity + Popular Artists)
  // Uses database queries instead of deprecated Spotify API
  console.log(
    '[spotifyApiServer] Using database-only approach for related artists'
  )

  const { getRelatedArtistsFromDatabase } = await import(
    './game/relatedArtistsDb'
  )
  let artists = await getRelatedArtistsFromDatabase(artistId)

  if (artists.length > 0 && statisticsTracker) {
    // These are from database, not Spotify API
    statisticsTracker.recordCacheHit('relatedArtists', 'database')
  }

  console.log(
    '[spotifyApiServer] Database lookup found:',
    artists.length,
    'artists'
  )

  // Save to graph for future lookups if we got results
  if (artists.length > 0) {
    void saveToArtistGraph(
      artistId,
      artists[0]?.name || 'Unknown Artist',
      artists.map((a) => ({ ...a, type: 'database' }))
    )
  }

  // Store in memory cache (even if empty, to avoid retrying immediately)
  cache.set(
    memCacheKey,
    artists,
    artists.length > 0 ? 10 * 60 * 1000 : 60 * 1000
  )
  return artists
}

/**
 * OLD MULTI-LEVEL APPROACH BELOW (DEPRECATED - Removed ~400 lines)
 * The code below has been replaced by the hybrid approach above
 *
 * Old approach issues:
 * - Level 1 + Level 2 top tracks fetching = 50+ sequential API calls
 * - Each call added ~1 second = 50+ second load times
 * - Genre fallback with 3 genres = additional 10-15 seconds
 *
 * New hybrid approach:
 * - Tier 1 (graph cache): 0 API calls, <50ms
 * - Tier 2 (genre similarity): 1-2 API calls, 2-5 seconds
 * - Result: 95%+ instant after warmup, 2-5s cold start
 */

/**
 * Searches for tracks by genre to find similar music
 * Uses database-first approach: checks DB cache first, then Spotify API as fallback
 * @param genres - Array of genres to search
 * @param token - Optional user token
 * @param limit - Number of tracks to return
 */
export async function searchTracksByGenreServer(
  genres: string[],
  token?: string,
  limit: number = 50
): Promise<TrackDetails[]> {
  if (!genres.length) return []

  // DATABASE-FIRST: Check database cache first
  const dbResult = await fetchTracksByGenreFromDb({
    genres,
    minPopularity: 15,
    maxPopularity: 100,
    limit,
    excludeSpotifyTrackIds: new Set() // No exclusions needed for general genre search
  })

  if (dbResult.tracks.length > 0) {
    console.log(
      `[spotifyApiServer] DB cache hit for genre search: ${dbResult.tracks.length} tracks for genres: ${genres.slice(0, 3).join(', ')}`
    )
    return dbResult.tracks.slice(0, limit)
  }

  console.log(
    `[spotifyApiServer] DB cache miss for genre search, fetching from Spotify: ${genres.slice(0, 3).join(', ')}`
  )

  try {
    // Use the first 2 genres for search
    const genreQuery = genres.slice(0, 2).join(' ')
    const response = await sendApiRequest<{
      tracks: { items: TrackDetails[] }
    }>({
      path: `/search?q=genre:${encodeURIComponent(genreQuery)}&type=track&limit=${limit}`,
      method: 'GET',
      token,
      useAppToken: !token
    })

    const tracks = response.tracks?.items ?? []

    // FIRE-AND-FORGET: Update database cache
    if (tracks.length > 0) {
      void upsertTrackDetails(tracks)
    }

    return tracks
  } catch (error) {
    console.error('[spotifyApiServer] Failed to search tracks by genre:', {
      genres,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

/**
 * Fetches all albums by an artist to get more tracks
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token
 */
export async function getArtistAlbumsServer(
  artistId: string,
  token?: string
): Promise<Array<{ id: string; name: string; release_date?: string }>> {
  // Validate artist ID before making API calls
  if (!artistId || artistId.trim() === '') {
    console.error('[spotifyApiServer] Invalid or empty artist ID provided')
    return []
  }

  try {
    const response = await sendApiRequest<{
      items: Array<{ id: string; name: string; release_date?: string }>
    }>({
      path: `/artists/${artistId}/albums?limit=50&include_groups=album,single`,
      method: 'GET',
      token,
      useAppToken: !token
    })

    return response.items ?? []
  } catch (error) {
    console.error('[spotifyApiServer] Failed to fetch artist albums:', {
      artistId,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

/**
 * Fetches tracks from an album
 * @param albumId - The Spotify album ID
 * @param token - Optional user token
 */
export async function getAlbumTracksServer(
  albumId: string,
  token?: string
): Promise<TrackDetails[]> {
  try {
    const response = await sendApiRequest<{
      items: TrackDetails[]
    }>({
      path: `/albums/${albumId}/tracks?limit=50`,
      method: 'GET',
      token,
      useAppToken: !token
    })

    return response.items ?? []
  } catch (error) {
    console.error('[spotifyApiServer] Failed to fetch album tracks:', {
      albumId,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

/**
 * Fetches the top tracks for a given artist (server-side only)
 * Uses database-first approach with consistent caching
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token. If provided, uses this token instead of app token.
 */
export async function getArtistTopTracksServer(
  artistId: string,
  token?: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<TrackDetails[]> {
  // Validate artist ID before making API calls
  if (!artistId || artistId.trim() === '') {
    console.error('[spotifyApiServer] Invalid or empty artist ID provided')
    return []
  }

  // Check in-memory cache first
  const memCacheKey = `artist-top-tracks:${artistId}`
  const memCached = cache.get<TrackDetails[]>(memCacheKey)
  if (memCached) {
    console.log('[spotifyApiServer] Memory cache hit for top tracks:', artistId)
    // Note: Statistics tracking is handled by callers to avoid double-counting
    return memCached
  }

  // DATABASE-FIRST: Check database cache using consistent pattern
  const dbCachedTrackIds = await getCachedTopTracks(artistId)
  if (dbCachedTrackIds.length > 0) {
    console.log(
      '[spotifyApiServer] DB cache hit:',
      dbCachedTrackIds.length,
      'top tracks for',
      artistId
    )
    // Note: Statistics tracking is handled by callers to avoid double-counting
    // For DB cache hits, we need to fetch full track details
    // Check if we have them in memory or need to get minimal objects
    // Since callers expect full TrackDetails, return minimal objects for now
    // (full details will be fetched on-demand if needed)
    const tracks = dbCachedTrackIds.map(
      (id) =>
        ({
          id,
          uri: `spotify:track:${id}`,
          name: '',
          duration_ms: 0,
          popularity: 0,
          preview_url: null,
          is_playable: true,
          explicit: false,
          album: { name: '', images: [], release_date: '' },
          artists: [{ id: artistId, name: '' }]
        }) as TrackDetails
    )
    // Store in memory cache (10-minute TTL)
    cache.set(memCacheKey, tracks, 10 * 60 * 1000)
    return tracks
  }

  console.log(
    '[spotifyApiServer] Cache miss: fetching top tracks from Spotify for',
    artistId
  )

  try {
    const response = await sendApiRequest<{ tracks: TrackDetails[] }>({
      path: `artists/${artistId}/top-tracks?market=US`, // Market is required for top tracks
      method: 'GET',
      token, // Use provided token if available, otherwise useAppToken will be used
      useAppToken: !token, // Only use app token if no user token provided
      retryConfig: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      },
      statisticsTracker
    })

    const tracks = response.tracks || []

    // FIRE-AND-FORGET: Save to database cache
    void upsertTopTracks(
      artistId,
      tracks.map((t) => t.id)
    )

    // Store in memory cache (10-minute TTL)
    cache.set(memCacheKey, tracks, 10 * 60 * 1000)

    return tracks
  } catch (error) {
    console.error('[spotifyApiServer] getArtistTopTracksServer error:', error)
    throw new Error(
      `Failed to fetch artist top tracks: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}
