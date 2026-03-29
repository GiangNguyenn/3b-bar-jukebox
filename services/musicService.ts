import { cache } from '@/shared/utils/cache'
import type { SpotifyArtist, TrackDetails } from '@/shared/types/spotify'
import type { TargetArtist } from '@/services/gameService'
import type { ApiStatisticsTracker } from '@/shared/apiCallCategorizer'
import * as spotifyApi from './spotifyApiServer'
import {
  batchGetArtistProfilesWithCache,
  batchUpsertArtistProfiles
} from './game/artistCache'
import { sendApiRequest } from '@/shared/api'
import { supabase } from '@/lib/supabase'
import { SupabaseClient } from '@supabase/supabase-js'
import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('MusicService')

export interface ArtistProfile {
  id: string
  name: string
  genres: string[]
  popularity: number
  followers?: number
  images?: { url: string; height?: number; width?: number }[]
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
 * Implements strict layered architecture: Memory -> Database -> Spotify
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
      // 2. Database & Spotify (via artistCache batch operation)
      const profiles = await batchGetArtistProfilesWithCache([artistId], token)
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
        return { data: profile, source: DataSource.Database }
      }
    } catch (err) {
      log(
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
    // Direct Spotify API call
    try {
      const track = await sendApiRequest<TrackDetails>({
        path: `/tracks/${trackId}`,
        method: 'GET',
        token
      })

      return { data: track, source: DataSource.SpotifyAPI }
    } catch (error) {
      log(
        'WARN',
        `Failed to fetch track ${trackId}`,
        'getTrack',
        error instanceof Error ? error : undefined
      )
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

    // 2. Spotify API (via spotifyApiServer which handles its own memory cache)
    try {
      const spotifyTracks = await spotifyApi.getArtistTopTracksServer(
        artistId,
        token,
        statisticsTracker
      )

      if (spotifyTracks.length > 0) {
        statisticsTracker?.recordFromSpotify('topTracks', spotifyTracks.length)
        cache.set(memKey, spotifyTracks)
        return { data: spotifyTracks, source: DataSource.SpotifyAPI }
      }
    } catch (err) {
      log(
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

    // 2. Spotify API (via spotifyApiServer which handles memory cache and API fallback)
    try {
      const related = await spotifyApi.getRelatedArtistsServer(
        artistId,
        token,
        statisticsTracker
      )

      if (related.length > 0) {
        cache.set(memKey, related)
        return { data: related, source: DataSource.SpotifyAPI }
      }
    } catch (err) {
      log(
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
      .select('name, spotify_artist_id, genres, popularity')
      .order('popularity', { ascending: false })
      .limit(limit)

    if (!error && artists && artists.length >= 20) {
      const mappedArtists: TargetArtist[] = artists.map((a: any) => ({
        id: a.spotify_artist_id,
        name: a.name,
        spotify_artist_id: a.spotify_artist_id,
        genres: a.genres || [],
        popularity: a.popularity,
        followers: 0,
        image_url: undefined
      }))

      return {
        data: mappedArtists,
        source: DataSource.Database
      }
    }

    // 2. Fallback
    log('WARN', 'Insufficient popular artists in DB.', 'getPopularArtists')
    return {
      data: (artists as TargetArtist[]) || [],
      source: DataSource.Database
    }
  },

  /**
   * Search Artists by Name
   */
  searchArtists: async (
    query: string,
    limit: number = 20
  ): Promise<DataResponse<TargetArtist[]>> => {
    // 1. Database
    const { data: artists, error } = await supabase
      .from('artists')
      .select('name, spotify_artist_id, genres, popularity')
      .ilike('name', `%${query}%`)
      .order('popularity', { ascending: false })
      .limit(limit)

    if (error) {
      log(
        'ERROR',
        `Failed to search artists with query "${query}"`,
        'searchArtists',
        error as any
      )
      return { data: [], source: DataSource.Database }
    }

    if (artists && artists.length > 0) {
      const mappedArtists: TargetArtist[] = artists.map((a: any) => ({
        id: a.spotify_artist_id,
        name: a.name,
        spotify_artist_id: a.spotify_artist_id,
        genres: a.genres || [],
        popularity: a.popularity,
        followers: 0,
        image_url: undefined
      }))

      return {
        data: mappedArtists,
        source: DataSource.Database
      }
    }

    return { data: [], source: DataSource.Database }
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
      .select('name, spotify_artist_id, genres, popularity')
      .order('popularity', { ascending: false })
      .limit(limit)

    if (!error && artists && artists.length >= 50) {
      const mappedArtists: TargetArtist[] = artists.map((a: any) => ({
        id: a.spotify_artist_id,
        name: a.name,
        spotify_artist_id: a.spotify_artist_id,
        genres: a.genres || [],
        popularity: a.popularity,
        followers: 0,
        image_url: undefined
      }))

      return {
        data: mappedArtists,
        source: DataSource.Database
      }
    }

    // 2. Spotify Fallback
    log(
      'INFO',
      'DB popular artists empty/low. Seeding from Spotify.',
      'getPopularArtistsWithFallback'
    )

    try {
      const searchPromises = [0, 10, 20, 30, 40].map((offset) =>
        sendApiRequest<{ artists: { items: any[] } }>({
          path: `search?q=year:2022-2025&type=artist&limit=10&offset=${offset}`,
          method: 'GET',
          token,
          useAppToken: !token
        }).catch((err) => {
          log(
            'WARN',
            `Search page offset ${offset} failed`,
            'getPopularArtistsWithFallback',
            err instanceof Error ? err : undefined
          )
          return null
        })
      )

      const searchResults = await Promise.all(searchPromises)

      const fetchedArtists: TargetArtist[] = []

      for (const result of searchResults) {
        if (!result) continue
        const items = result.artists?.items || []

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
      }

      // 3. Fire-and-forget Update
      if (fetchedArtists.length > 0) {
        const profilesToUpsert = fetchedArtists.map((a) => ({
          id: a.id!,
          name: a.name,
          genres: a.genres || [],
          popularity: a.popularity,
          followers: { total: a.followers || 0 }
        }))

        void batchUpsertArtistProfiles(profilesToUpsert)
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
      log(
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
  }
}
