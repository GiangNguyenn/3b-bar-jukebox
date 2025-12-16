import type { SpotifyArtist } from '@/shared/types/spotify'
import { supabase, queryWithRetry } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { getFromArtistGraph } from './artistGraph'

const logger = createModuleLogger('RelatedArtistsDb')

/**
 * Get related artists from the pre-computed graph
 * Uses the artist_relationships table for instant lookups
 */
export async function getRelatedArtistsFromGraph(
  artistId: string
): Promise<SpotifyArtist[]> {
  try {
    // Use the existing artistGraph function with default parameters
    const results = await getFromArtistGraph(artistId, 0.3, 50)

    logger(
      'INFO',
      `Graph lookup for ${artistId}: ${results.length} related artists found`,
      'getRelatedArtistsFromGraph'
    )

    return results
  } catch (error) {
    logger(
      'ERROR',
      `Failed to get related artists from graph for ${artistId}`,
      'getRelatedArtistsFromGraph',
      error as Error
    )
    return []
  }
}

/**
 * Find artists with similar genres using database queries
 * Calculates genre overlap and returns artists sorted by similarity
 */
export async function getRelatedArtistsByGenre(
  artistId: string,
  limit: number = 20
): Promise<SpotifyArtist[]> {
  try {
    // First, get the source artist's genres
    const { data: sourceArtist, error: sourceError } = await queryWithRetry<{
      genres: string[]
      name: string
    }>(
      supabase
        .from('artists')
        .select('genres, name')
        .eq('spotify_artist_id', artistId)
        .single(),
      undefined,
      'getRelatedArtistsByGenre-source'
    )

    if (sourceError || !sourceArtist || !sourceArtist.genres?.length) {
      logger(
        'WARN',
        `No genres found for artist ${artistId}`,
        'getRelatedArtistsByGenre'
      )
      return []
    }

    const sourceGenres = sourceArtist.genres

    // Query for artists with overlapping genres
    // Using PostgreSQL's array overlap operator (&&)
    // Supabase uses .overlaps() for array overlap queries
    const { data: candidates, error: candidatesError } = await queryWithRetry<
      {
        spotify_artist_id: string
        name: string
        genres: string[]
        popularity: number
      }[]
    >(
      supabase
        .from('artists')
        .select('spotify_artist_id, name, genres, popularity')
        .neq('spotify_artist_id', artistId) // Exclude self
        .not('genres', 'is', null) // Must have genres
        .overlaps('genres', sourceGenres) // Array overlap
        .limit(100) as any, // Type cast for query builder
      undefined,
      'getRelatedArtistsByGenre-candidates'
    )

    if (candidatesError || !candidates) {
      logger(
        'ERROR',
        `Failed to query candidates for ${artistId}`,
        'getRelatedArtistsByGenre',
        candidatesError as Error
      )
      return []
    }

    // Calculate genre similarity for each candidate
    const scoredCandidates = candidates
      .map((candidate) => {
        const candidateGenres = candidate.genres || []

        // Calculate Jaccard similarity: intersection / union
        const intersection = sourceGenres.filter((g) =>
          candidateGenres.includes(g)
        ).length
        const union = new Set([...sourceGenres, ...candidateGenres]).size
        const similarity = union > 0 ? intersection / union : 0

        return {
          id: candidate.spotify_artist_id,
          name: candidate.name,
          similarity,
          popularity: candidate.popularity || 0
        }
      })
      .filter((c) => c.similarity > 0.2) // Minimum 20% genre overlap
      .sort((a, b) => {
        // Sort by similarity first, then popularity as tiebreaker
        if (Math.abs(a.similarity - b.similarity) < 0.01) {
          return b.popularity - a.popularity
        }
        return b.similarity - a.similarity
      })
      .slice(0, limit)

    logger(
      'INFO',
      `Genre similarity for ${sourceArtist.name}: ${scoredCandidates.length} related artists (from ${candidates.length} candidates)`,
      'getRelatedArtistsByGenre'
    )

    return scoredCandidates.map((c) => ({
      id: c.id,
      name: c.name
    }))
  } catch (error) {
    logger(
      'ERROR',
      `Error in getRelatedArtistsByGenre for ${artistId}`,
      'getRelatedArtistsByGenre',
      error as Error
    )
    return []
  }
}

/**
 * Find popular artists within the same genre space
 * Returns well-known artists that share genres with the source artist
 */
export async function getPopularArtistsByGenre(
  artistId: string,
  limit: number = 10
): Promise<SpotifyArtist[]> {
  try {
    // First, get the source artist's genres
    const { data: sourceArtist, error: sourceError } = await queryWithRetry<{
      genres: string[]
      name: string
    }>(
      supabase
        .from('artists')
        .select('genres, name')
        .eq('spotify_artist_id', artistId)
        .single(),
      undefined,
      'getPopularArtistsByGenre-source'
    )

    if (sourceError || !sourceArtist || !sourceArtist.genres?.length) {
      logger(
        'WARN',
        `No genres found for artist ${artistId}`,
        'getPopularArtistsByGenre'
      )
      return []
    }

    const sourceGenres = sourceArtist.genres

    // Query for popular artists with overlapping genres
    const { data: popularArtists, error: popularError } = await queryWithRetry<
      {
        spotify_artist_id: string
        name: string
        popularity: number
      }[]
    >(
      supabase
        .from('artists')
        .select('spotify_artist_id, name, popularity')
        .neq('spotify_artist_id', artistId) // Exclude self
        .overlaps('genres', sourceGenres) // Array overlap
        .gte('popularity', 50) // Only popular artists
        .order('popularity', { ascending: false })
        .limit(limit) as any, // Type cast for query builder
      undefined,
      'getPopularArtistsByGenre-popular'
    )

    if (popularError || !popularArtists) {
      logger(
        'ERROR',
        `Failed to query popular artists for ${artistId}`,
        'getPopularArtistsByGenre',
        popularError as Error
      )
      return []
    }

    logger(
      'INFO',
      `Popular artists for ${sourceArtist.name}: ${popularArtists.length} found`,
      'getPopularArtistsByGenre'
    )

    return popularArtists.map((a) => ({
      id: a.spotify_artist_id,
      name: a.name
    }))
  } catch (error) {
    logger(
      'ERROR',
      `Error in getPopularArtistsByGenre for ${artistId}`,
      'getPopularArtistsByGenre',
      error as Error
    )
    return []
  }
}

/**
 * Orchestrator function that combines all strategies with fallback logic
 * Returns related artists using the best available method
 */
export async function getRelatedArtistsFromDatabase(
  artistId: string
): Promise<SpotifyArtist[]> {
  logger(
    'INFO',
    `Finding related artists for ${artistId} using database strategies`,
    'getRelatedArtistsFromDatabase'
  )

  // Strategy 1: Try pre-computed graph (fastest, most accurate)
  const graphResults = await getRelatedArtistsFromGraph(artistId)
  if (graphResults.length >= 5) {
    logger(
      'INFO',
      `Using graph results: ${graphResults.length} artists`,
      'getRelatedArtistsFromDatabase'
    )
    return graphResults
  }

  // Strategy 2: Genre similarity (good fallback)
  const genreResults = await getRelatedArtistsByGenre(artistId, 20)

  // Combine graph and genre results, removing duplicates
  const combined = [...graphResults]
  const existingIds = new Set(graphResults.map((a) => a.id))

  for (const artist of genreResults) {
    if (!existingIds.has(artist.id)) {
      combined.push(artist)
      existingIds.add(artist.id)
    }
  }

  if (combined.length >= 5) {
    logger(
      'INFO',
      `Using combined graph + genre results: ${combined.length} artists`,
      'getRelatedArtistsFromDatabase'
    )
    return combined
  }

  // Strategy 3: Add popular artists if still insufficient
  const popularResults = await getPopularArtistsByGenre(artistId, 10)

  for (const artist of popularResults) {
    if (!existingIds.has(artist.id)) {
      combined.push(artist)
      existingIds.add(artist.id)
    }
  }

  logger(
    'INFO',
    `Final combined results: ${combined.length} artists (graph: ${graphResults.length}, genre: ${genreResults.length}, popular: ${popularResults.length})`,
    'getRelatedArtistsFromDatabase'
  )

  return combined
}

