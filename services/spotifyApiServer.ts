/**
 * Server-side only Spotify API utilities
 * These methods can be safely used in API routes without importing client-side code
 */
import { sendApiRequest } from '@/shared/api'
import type { SpotifyArtist, TrackDetails } from '@/shared/types/spotify'
import { cache } from '@/shared/utils/cache'
import { createModuleLogger } from '@/shared/utils/logger'
import type { ApiStatisticsTracker } from '@/shared/apiCallCategorizer'

const log = createModuleLogger('spotifyApiServer')

/**
 * Fetches artists related to the given artist (server-side only)
 * Uses memory cache with direct Spotify API fallback
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

  log('LOG', `Looking up related artists for: ${artistId}`)

  // Check in-memory cache first (fastest)
  const memCacheKey = `related-artists:${artistId}`
  const memCached = cache.get<SpotifyArtist[]>(memCacheKey)
  if (memCached) {
    log('LOG', `Memory cache hit for related artists: ${artistId}`)
    statisticsTracker?.recordCacheHit('relatedArtists', 'memory')
    return memCached
  }

  // Direct Spotify API call
  log(
    'LOG',
    `Cache miss: fetching related artists from Spotify for ${artistId}`
  )

  try {
    const response = await sendApiRequest<{ artists: SpotifyArtist[] }>({
      path: `/artists/${artistId}/related-artists`,
      method: 'GET',
      token,
      useAppToken: !token,
      retryConfig: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      },
      statisticsTracker
    })

    const artists = response.artists ?? []

    if (statisticsTracker && artists.length > 0) {
      statisticsTracker.recordFromSpotify('relatedArtists', artists.length)
    }

    // Store in memory cache (10-minute TTL, or 1-minute for empty results)
    cache.set(
      memCacheKey,
      artists,
      artists.length > 0 ? 10 * 60 * 1000 : 60 * 1000
    )
    return artists
  } catch (error) {
    log(
      'ERROR',
      `Failed to fetch related artists: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return []
  }
}

/**
 * Fetches the top tracks for a given artist (server-side only)
 * Uses memory cache with direct Spotify API fallback
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token. If provided, uses this token instead of app token.
 * @param statisticsTracker - Optional statistics tracker for performance monitoring
 */
export async function getArtistTopTracksServer(
  artistId: string,
  token?: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<TrackDetails[]> {
  // Validate artist ID before making API calls
  if (!artistId || artistId.trim() === '') {
    log('ERROR', 'Invalid or empty artist ID provided')
    return []
  }

  // Check in-memory cache first
  const memCacheKey = `artist-top-tracks:${artistId}`
  const memCached = cache.get<TrackDetails[]>(memCacheKey)
  if (memCached) {
    log('LOG', `Memory cache hit for top tracks: ${artistId}`)
    return memCached
  }

  log('LOG', `Cache miss: fetching top tracks from Spotify for ${artistId}`)

  try {
    const response = await sendApiRequest<{ tracks: TrackDetails[] }>({
      path: `artists/${artistId}/top-tracks?market=US`,
      method: 'GET',
      token,
      useAppToken: !token,
      retryConfig: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      },
      statisticsTracker
    })

    const tracks = response.tracks || []

    if (statisticsTracker) {
      statisticsTracker.recordFromSpotify('topTracks', 1)
    }

    // Store in memory cache (10-minute TTL)
    cache.set(memCacheKey, tracks, 10 * 60 * 1000)

    return tracks
  } catch (error) {
    log(
      'ERROR',
      `getArtistTopTracksServer error: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    throw new Error(
      `Failed to fetch artist top tracks: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}
