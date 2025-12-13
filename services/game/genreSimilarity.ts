/**
 * Genre-based artist similarity discovery
 * Fast fallback method using Spotify search API
 */

import { sendApiRequest } from '@/shared/api'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  batchGetArtistProfilesWithCache,
  batchUpsertArtistProfiles
} from './dgsCache'
import type { ApiStatisticsTracker } from './apiStatisticsTracker'

const logger = createModuleLogger('GenreSimilarity')

interface ArtistProfile {
  id: string
  name: string
  genres: string[]
  popularity: number
}

interface SimilarArtist {
  id: string
  name: string
  strength: number
}

/**
 * Find related artists using genre similarity and popularity matching
 * Fast alternative to top tracks multi-level discovery (1-2 API calls vs 50+)
 */
export async function getRelatedByGenreSimilarity(
  seedArtist: ArtistProfile,
  token: string,
  limit = 50,
  statisticsTracker?: ApiStatisticsTracker
): Promise<SimilarArtist[]> {
  const results: SimilarArtist[] = []
  const seenArtistIds = new Set<string>([seedArtist.id])

  // Use primary genres (max 2 to keep query fast)
  const primaryGenres = seedArtist.genres.slice(0, 2)

  // If no genres, use popularity-based search as fallback
  if (primaryGenres.length === 0) {
    logger(
      'WARN',
      `No genres available for artist ${seedArtist.name}, using popularity fallback`,
      'getRelatedByGenreSimilarity'
    )

    try {
      // Track search API call (not artist profile fetch)
      statisticsTracker?.recordApiCall('relatedArtists')

      const response = await sendApiRequest<{
        artists: {
          items: Array<{
            id: string
            name: string
            genres: string[]
            popularity: number
          }>
        }
      }>({
        path: `search?q=year:2020-2024&type=artist&limit=50&market=US`,
        method: 'GET',
        token,
        useAppToken: !token,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 2000
        }
      })

      if (response.artists?.items) {
        // Filter by popularity proximity if we have seed popularity
        const popularityFiltered = response.artists.items.filter((artist) => {
          if (seedArtist.popularity === 0) return true // No filter if seed has no popularity
          const diff = Math.abs(artist.popularity - seedArtist.popularity)
          return diff <= 30 // Within 30 points
        })

        const artists = (
          popularityFiltered.length > 0
            ? popularityFiltered
            : response.artists.items
        )
          .filter((artist) => artist.id !== seedArtist.id)
          .slice(0, limit)
          .map((artist) => ({
            id: artist.id,
            name: artist.name,
            strength: 0.3 // Low strength since no genre match
          }))

        // Cache found artists to database for future lookups (fire-and-forget)
        const artistsToCache = (
          popularityFiltered.length > 0
            ? popularityFiltered
            : response.artists.items
        ).map((artist) => ({
          id: artist.id,
          name: artist.name,
          genres: artist.genres || [],
          popularity: artist.popularity
        }))
        if (artistsToCache.length > 0) {
          void batchUpsertArtistProfiles(artistsToCache)
        }

        logger(
          'INFO',
          `Popularity fallback found ${artists.length} artists`,
          'getRelatedByGenreSimilarity'
        )

        return artists
      }
    } catch (error) {
      logger(
        'ERROR',
        'Popularity fallback failed',
        'getRelatedByGenreSimilarity',
        error as Error
      )
    }

    return []
  }

  logger(
    'INFO',
    `Finding similar artists for ${seedArtist.name} using genres: ${primaryGenres.join(', ')}`,
    'getRelatedByGenreSimilarity'
  )

  // Collect all artists found to cache to database
  const artistsToCache: Array<{
    id: string
    name: string
    genres: string[]
    popularity?: number
  }> = []

  for (const genre of primaryGenres) {
    try {
      // Search with quoted genre for exact match (faster and more accurate)
      const searchQuery = `genre:"${genre}"`

      // Track search API call (not artist profile fetch)
      statisticsTracker?.recordApiCall('relatedArtists')

      const response = await sendApiRequest<{
        artists: {
          items: Array<{
            id: string
            name: string
            genres: string[]
            popularity: number
          }>
        }
      }>({
        path: `search?q=${encodeURIComponent(searchQuery)}&type=artist&limit=50&market=US`,
        method: 'GET',
        token,
        useAppToken: !token,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 2000
        }
      })

      if (response.artists?.items) {
        for (const artist of response.artists.items) {
          // Skip if already seen or is the seed artist
          if (seenArtistIds.has(artist.id)) {
            continue
          }

          // Add to cache list
          artistsToCache.push({
            id: artist.id,
            name: artist.name,
            genres: artist.genres || [],
            popularity: artist.popularity
          })

          // Calculate similarity based on genre overlap and popularity proximity
          const genreOverlap = artist.genres.filter((g) =>
            seedArtist.genres.includes(g)
          ).length
          const genreScore =
            genreOverlap / Math.max(seedArtist.genres.length, 1)

          // Popularity similarity: closer is better
          const popularityDiff = Math.abs(
            artist.popularity - seedArtist.popularity
          )
          const popularityScore = 1 - popularityDiff / 100

          // Weighted combination: genre overlap is more important
          const strength = genreScore * 0.7 + popularityScore * 0.3

          // Only add if decent similarity (threshold 0.3)
          if (strength >= 0.3) {
            results.push({
              id: artist.id,
              name: artist.name,
              strength
            })
            seenArtistIds.add(artist.id)
          }
        }
      }
    } catch (error) {
      logger(
        'WARN',
        `Failed to search for genre "${genre}"`,
        'getRelatedByGenreSimilarity',
        error as Error
      )
      // Continue with next genre
    }
  }

  // Cache all found artists to database (fire-and-forget)
  if (artistsToCache.length > 0) {
    void batchUpsertArtistProfiles(artistsToCache)
  }

  // Sort by strength and limit
  const sorted = results.sort((a, b) => b.strength - a.strength).slice(0, limit)

  logger(
    'INFO',
    `Found ${sorted.length} similar artists for ${seedArtist.name} (avg strength: ${(sorted.reduce((sum, a) => sum + a.strength, 0) / sorted.length).toFixed(2)})`,
    'getRelatedByGenreSimilarity'
  )

  return sorted
}

/**
 * Get artist profile using database-first approach
 * Helper function to fetch genres and popularity
 */
export async function getArtistProfile(
  artistId: string,
  token?: string,
  statisticsTracker?: ApiStatisticsTracker
): Promise<ArtistProfile | null> {
  try {
    // Use database-first batch function for consistency
    const profilesMap = await batchGetArtistProfilesWithCache(
      [artistId],
      token || '',
      statisticsTracker
    )
    const profile = profilesMap.get(artistId)

    if (!profile) {
      logger(
        'WARN',
        `Failed to fetch artist profile for ${artistId}`,
        'getArtistProfile'
      )
      return null
    }

    return {
      id: profile.id,
      name: profile.name,
      genres: profile.genres || [],
      popularity: profile.popularity || 0
    }
  } catch (error) {
    logger(
      'ERROR',
      `Failed to fetch artist profile for ${artistId}`,
      'getArtistProfile',
      error as Error
    )
    return null
  }
}
