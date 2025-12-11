/**
 * Artist relationship graph functions for fast artist discovery
 * Uses pre-computed relationships with quality scores
 */

import { supabase } from '@/lib/supabase'
import type { SpotifyArtist } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('ArtistGraph')

interface ArtistRelationship {
  related_spotify_artist_id: string
  relationship_strength: number
  relationship_type: string | null
  artists: {
    name: string
  } | null
}

/**
 * Get related artists from pre-computed graph
 * Returns cached relationships sorted by quality
 */
export async function getFromArtistGraph(
  artistId: string,
  minStrength = 0.3,
  limit = 50,
  trackMetrics?: () => void
): Promise<SpotifyArtist[]> {
  try {
    const { data, error } = await supabase
      .from('artist_relationships')
      .select(
        'related_spotify_artist_id, relationship_strength, relationship_type, artists:related_spotify_artist_id(name)'
      )
      .eq('source_spotify_artist_id', artistId)
      .gte('relationship_strength', minStrength)
      .order('relationship_strength', { ascending: false })
      .limit(limit)

    if (error) {
      logger(
        'WARN',
        `Failed to query artist graph for ${artistId}`,
        'getFromArtistGraph',
        error
      )
      return []
    }

    if (!data || data.length === 0) {
      return []
    }

    logger(
      'INFO',
      `Graph cache hit: ${data.length} related artists for ${artistId} (min strength: ${minStrength})`,
      'getFromArtistGraph'
    )

    // Track metrics if callback provided
    if (trackMetrics) {
      trackMetrics()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((row: any) => ({
      id: row.related_spotify_artist_id,
      name: row.artists?.name || row.related_artist_name || ''
    }))
  } catch (error) {
    logger(
      'ERROR',
      `Error querying artist graph for ${artistId}`,
      'getFromArtistGraph',
      error as Error
    )
    return []
  }
}

/**
 * Save artist relationships to graph for future lookups
 * Upserts to avoid duplicates while updating quality scores
 */
export async function saveToArtistGraph(
  sourceArtistId: string,
  sourceArtistName: string,
  relatedArtists: Array<{
    id: string
    name: string
    strength?: number
    type?: string
  }>
): Promise<void> {
  if (relatedArtists.length === 0) {
    return
  }

  try {
    const relationships = relatedArtists.map((artist) => ({
      source_spotify_artist_id: sourceArtistId,
      source_artist_name: sourceArtistName,
      related_spotify_artist_id: artist.id,
      related_artist_name: artist.name,
      relationship_strength: artist.strength ?? 0.5,
      relationship_type: artist.type ?? 'genre',
      cached_at: new Date().toISOString()
    }))

    const { error } = await supabase
      .from('artist_relationships')
      .upsert(relationships, {
        onConflict: 'source_spotify_artist_id,related_spotify_artist_id',
        ignoreDuplicates: false // Update existing records with new strength/type
      })

    if (error) {
      logger(
        'WARN',
        `Failed to save ${relationships.length} relationships for ${sourceArtistId}`,
        'saveToArtistGraph',
        error
      )
      return
    }

    logger(
      'INFO',
      `Saved ${relationships.length} artist relationships for ${sourceArtistName} (${sourceArtistId})`,
      'saveToArtistGraph'
    )
  } catch (error) {
    logger(
      'ERROR',
      `Error saving artist relationships for ${sourceArtistId}`,
      'saveToArtistGraph',
      error as Error
    )
  }
}
