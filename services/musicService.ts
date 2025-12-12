import { cache } from '@/shared/utils/cache'
import type { SpotifyArtist, TrackDetails } from '@/shared/types/spotify'
import type { DgsOptionTrack } from '@/services/game/dgsTypes'
import type { TargetArtist } from '@/services/gameService'
import type { ApiStatisticsTracker } from './game/apiStatisticsTracker'
import * as dgsCache from './game/dgsCache'
import * as dgsDb from './game/dgsDb'
import * as spotifyApi from './spotifyApiServer'
import { sendApiRequest } from '@/shared/api'
import { getFromArtistGraph, saveToArtistGraph } from './game/artistGraph'
import { supabase } from '@/lib/supabase'
import { SupabaseClient } from '@supabase/supabase-js'

export interface ArtistProfile {
  id: string
  name: string
  genres: string[]
  popularity: number
  followers?: number
  images?: { url: string; height?: number; width?: number }[]
}

// Logger helper for consistent logging
const logger = (
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context: string = 'MusicService',
  error?: Error
) => {
  console.log(
    `[${new Date().toISOString()}] [${level}] [${context}] ${message}`,
    error || ''
  )
}

/**
 * SOURCE ENUM for tracking where data came from (Optimization Debugging)
 */
export enum DataSource {
  MemoryCache = 'MEMORY',
  Database = 'DATABASE',
  SpotifyAPI = 'SPOTIFY',
  Fallback = 'FALLBACK'
}

export type DataResponse<T> = {
  data: T
  source: DataSource
}

/**
 * Unified Music Data Service
 * Implements strict layered architecture: Memory -> Database -> Spotify -> Async DB Update
 */
export const musicService = {
  /**
   * Get Artist Profile
   */
  getArtist: async (
    artistId: string,
    token: string
  ): Promise<DataResponse<ArtistProfile | null>> => {
    const memKey = `artist_profile:${artistId}`

    // 1. Memory Cache
    const cached = cache.get<ArtistProfile | undefined>(memKey)
    if (cached) {
      return { data: cached, source: DataSource.MemoryCache }
    }

    try {
      // 2. Database & Spotify (Unified via dgsCache batch operation)
      const profiles = await dgsCache.batchGetArtistProfilesWithCache(
        [artistId],
        token
      )
      const fetched = profiles.get(artistId)

      if (fetched) {
        const profile: ArtistProfile = {
          id: fetched.id,
          name: fetched.name,
          genres: fetched.genres || [],
          popularity: fetched.popularity || 0,
          followers: fetched.followers
        }

        cache.set(memKey, profile)
        // If it came from batchGet, we trust it; broadly labeling as SpotifyAPI/Database depending on internal hit
        // dgsCache updates cache automatically.
        return { data: profile, source: DataSource.Database }
      }
    } catch (err) {
      logger(
        'ERROR',
        `Failed to fetch artist ${artistId}`,
        'getArtist',
        err instanceof Error ? err : undefined
      )
    }

    return { data: null, source: DataSource.Fallback }
  },

  /**
   * Get Track
   */
  async getTrack(
    trackId: string,
    token: string
  ): Promise<DataResponse<TrackDetails | null>> {
    try {
      const track = await sendApiRequest<TrackDetails>({
        path: `/tracks/${trackId}`,
        method: 'GET',
        token
      })
      return { data: track, source: DataSource.SpotifyAPI }
    } catch (error) {
      logger('WARN', `Failed to fetch track ${trackId}`, 'getTrack', error as Error)
      return { data: null, source: DataSource.Fallback }
    }
  },

  /**
   * Get Artist Top Tracks
   */
  getTopTracks: async (
    artistId: string,
    token: string,
    statisticsTracker?: ApiStatisticsTracker
  ): Promise<DataResponse<TrackDetails[]>> => {
    const memKey = `top_tracks:${artistId}`

    // Track request
    statisticsTracker?.recordRequest('topTracks')

    // 1. Memory Cache
    const cached = cache.get<TrackDetails[]>(memKey)
    if (cached) {
      statisticsTracker?.recordCacheHit('topTracks', 'memory')
      return { data: cached, source: DataSource.MemoryCache }
    }

    // 2. Database Cache
    const dbTracksMap = await dgsCache.batchGetTopTracksFromDb([artistId])
    const dbTracks = dbTracksMap.get(artistId)

    if (dbTracks && dbTracks.length > 0) {
      statisticsTracker?.recordCacheHit('topTracks', 'database')
      cache.set(memKey, dbTracks)
      return { data: dbTracks, source: DataSource.Database }
    }

    // 3. Spotify API
    try {
      const spotifyTracks = await spotifyApi.getArtistTopTracksServer(
        artistId,
        token,
        statisticsTracker
      )

      if (spotifyTracks.length > 0) {
        statisticsTracker?.recordFromSpotify('topTracks', spotifyTracks.length)
        // 4. Async Update (Fire and forget)
        void dgsDb.upsertTrackDetails(spotifyTracks)
        void dgsCache.upsertTopTracks(
          artistId,
          spotifyTracks.map((t) => t.id)
        )

        cache.set(memKey, spotifyTracks)
        return { data: spotifyTracks, source: DataSource.SpotifyAPI }
      }
    } catch (err) {
      logger(
        'ERROR',
        `Failed to fetch top tracks for ${artistId}`,
        'getTopTracks',
        err instanceof Error ? err : undefined
      )
    }

    return { data: [], source: DataSource.Fallback }
  },

  /**
   * Get Related Artists
   */
  getRelatedArtists: async (
    artistId: string,
    token: string,
    statisticsTracker?: ApiStatisticsTracker
  ): Promise<DataResponse<SpotifyArtist[]>> => {
    const memKey = `related_artists:${artistId}`

    // Track request
    statisticsTracker?.recordRequest('relatedArtists')

    // 1. Memory Cache
    const cached = cache.get<SpotifyArtist[]>(memKey)
    if (cached) {
      statisticsTracker?.recordCacheHit('relatedArtists', 'memory')
      return { data: cached, source: DataSource.MemoryCache }
    }

    // 2. Spotify API (via getRelatedArtistsServer which handles graph cache, DB cache, and API fallback)
    // Note: We removed duplicate graph cache check here since getRelatedArtistsServer already handles it
    try {
      // Pass statisticsTracker through so getRelatedArtistsServer can track API calls internally
      const related = await spotifyApi.getRelatedArtistsServer(
        artistId,
        token,
        statisticsTracker
      )

      if (related.length > 0) {
        // getRelatedArtistsServer handles its own tracking (cache hits and API items)
        cache.set(memKey, related)
        return { data: related, source: DataSource.SpotifyAPI }
      }
    } catch (err) {
      logger(
        'ERROR',
        `Failed to fetch related candidates for ${artistId}`,
        'getRelatedArtists',
        err instanceof Error ? err : undefined
      )
    }

    return { data: [], source: DataSource.Fallback }
  },

  /**
   * Get Popular Artists
   */
  getPopularArtists: async (
    limit: number = 200,
    dbClient?: SupabaseClient
  ): Promise<DataResponse<TargetArtist[]>> => {
    // 1. Database
    const db = dbClient || supabase

    const { data: artists, error } = await db
      .from('artists')
      .select('*')
      .order('popularity', { ascending: false })
      .limit(limit)

    if (!error && artists && artists.length >= 20) {
      return {
        data: artists as TargetArtist[],
        source: DataSource.Database
      }
    }

    // 2. Fallback (Logging only, as this method relies on DB or caller to provide fallback logic via other methods)
    logger('WARN', 'Insufficient popular artists in DB.', 'getPopularArtists')
    return {
      data: (artists as TargetArtist[]) || [],
      source: DataSource.Database
    }
  },

  /**
   * Get Popular Artists WITH Token (Explicit Fallback Version)
   */
  getPopularArtistsWithFallback: async (
    token: string,
    limit: number = 200
  ): Promise<DataResponse<TargetArtist[]>> => {
    const db = supabase

    // 1. Try DB first
    const { data: artists, error } = await db
      .from('artists')
      .select('*')
      .order('popularity', { ascending: false })
      .limit(limit)

    if (!error && artists && artists.length >= 50) {
      return {
        data: artists as TargetArtist[],
        source: DataSource.Database
      }
    }

    // 2. Spotify Fallback
    logger(
      'INFO',
      'DB popular artists empty/low. Seeding from Spotify.',
      'getPopularArtistsWithFallback'
    )

    try {
      const searchResults = await sendApiRequest<{ artists: { items: any[] } }>(
        {
          path: 'search?q=year:2022-2025&type=artist&limit=50',
          method: 'GET',
          token,
          useAppToken: !token
        }
      )

      const items = searchResults?.artists?.items || []
      const fetchedArtists: TargetArtist[] = []

      for (const item of items) {
        if (!item.id) continue

        const artist: TargetArtist = {
          id: item.id,
          name: item.name,
          genres: item.genres || [],
          popularity: item.popularity || 50,
          followers: item.followers?.total || 0,
          image_url: item.images?.[0]?.url
        }
        fetchedArtists.push(artist)
      }

      // 3. Fire-and-forget Update
      if (fetchedArtists.length > 0) {
        // Transform to CachedArtistProfile for upsert
        const profilesToUpsert = fetchedArtists.map((a) => ({
          id: a.id!,
          name: a.name,
          genres: a.genres || [],
          popularity: a.popularity,
          followers: { total: a.followers || 0 }
        }))

        void dgsCache.batchUpsertArtistProfiles(profilesToUpsert)
      }

      // Return combined list (DB + Fetched)
      const combined = [
        ...((artists as TargetArtist[]) || []),
        ...fetchedArtists
      ]
      // dedupe
      const unique = Array.from(
        new Map(combined.map((a) => [a.id, a])).values()
      )

      return {
        data: unique.slice(0, limit),
        source: DataSource.SpotifyAPI
      }
    } catch (err) {
      logger(
        'ERROR',
        'Failed to fetch fallback popular artists',
        'getPopularArtistsWithFallback',
        err instanceof Error ? err : undefined
      )
      return {
        data: (artists as TargetArtist[]) || [],
        source: DataSource.Database
      }
    }
  },

  /**
   * Search Tracks by Genre
   */
  searchTracksByGenre: async (
    genres: string[],
    token: string,
    limit: number = 20
  ): Promise<DataResponse<DgsOptionTrack[]>> => {
    const memKey = `genre_search:${genres.sort().join(',')}:${limit}`
    const cached = cache.get<DgsOptionTrack[]>(memKey)
    if (cached) {
      return { data: cached, source: DataSource.MemoryCache }
    }

    try {
      const tracks = await spotifyApi.searchTracksByGenreServer(
        genres,
        token,
        limit
      )

      // 2. Fire-and-Forget Update
      void dgsDb.upsertTrackDetails(tracks)

      const optionTracks: DgsOptionTrack[] = tracks.map((t) => ({
        track: t,
        artist: {
          id: t.artists?.[0]?.id || 'unknown',
          name: t.artists?.[0]?.name || 'Unknown',
          uri: '',
          genres: [],
          popularity: 0,
          images: []
        },
        metrics: {
          source: 'target_insertion',
          simScore: 0,
          aAttraction: 0,
          bAttraction: 0,
          gravityScore: 0,
          stabilizedScore: 0,
          finalScore: 0,
          popularityBand: 'mid',
          vicinityDistances: {} as any,
          currentSongAttraction: 0
        } as any
      }))

      cache.set(memKey, optionTracks)
      return { data: optionTracks, source: DataSource.SpotifyAPI }
    } catch (err) {
      logger(
        'ERROR',
        'Failed to search tracks by genre',
        'searchTracksByGenre',
        err instanceof Error ? err : undefined
      )
    }

    return { data: [], source: DataSource.Fallback }
  }
}
