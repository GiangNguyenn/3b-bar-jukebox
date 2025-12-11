import type { TrackDetails } from '@/shared/types/spotify'
import type { Database } from '@/types/supabase'
import { supabase, queryWithRetry } from '@/lib/supabase'
import { safeBackfillTrackGenre } from './genreBackfill'
import { safeBackfillTrackDetails } from './trackBackfill'

import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('DgsDb')

type DbTrackRow = Database['public']['Tables']['tracks']['Row']

interface FetchRandomTracksParams {
  neededArtists: number
  existingArtistNames: Set<string>
  excludeSpotifyTrackIds: Set<string>
  tracksPerArtist?: number // Optional: allow multiple tracks per artist
}

interface FetchRandomTracksResult {
  tracks: TrackDetails[]
  uniqueArtistsAdded: number
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
}

export async function fetchRandomTracksFromDb({
  neededArtists,
  existingArtistNames,
  excludeSpotifyTrackIds,
  tracksPerArtist = 1
}: FetchRandomTracksParams): Promise<FetchRandomTracksResult> {
  if (neededArtists <= 0) {
    return { tracks: [], uniqueArtistsAdded: 0 }
  }

  // First, get all profiled artists from the artists table
  const { data: profiledArtists, error: artistsError } = await queryWithRetry<
    {
      name: string
      spotify_artist_id: string
    }[]
  >(
    supabase
      .from('artists')
      .select('name, spotify_artist_id')
      .not('spotify_artist_id', 'is', null),
    undefined,
    'DGS fetch profiled artists for random tracks'
  )

  if (artistsError || !profiledArtists || profiledArtists.length === 0) {
    logger(
      'WARN',
      `DB fallback: no profiled artists found in database (${profiledArtists?.length ?? 0} artists)`,
      'fetchRandomTracksFromDb'
    )
    return { tracks: [], uniqueArtistsAdded: 0 }
  }

  // Create a map of normalized artist name -> spotify_artist_id
  const artistProfileMap = new Map<string, string>()
  profiledArtists.forEach((artist) => {
    const normalizedName = (artist.name ?? '').trim().toLowerCase()
    if (normalizedName) {
      artistProfileMap.set(normalizedName, artist.spotify_artist_id)
    }
  })

  logger(
    'INFO',
    `DB fallback: ${artistProfileMap.size} profiled artists available for filtering`
  )

  // Fetch more rows than we need so we can filter by uniqueness and exclusions
  const fetchLimit = Math.min(neededArtists * 5, 1000) // Increased multiplier since we're filtering more

  logger(
    'INFO',
    `DB fallback: attempting to fetch up to ${fetchLimit} tracks to satisfy ${neededArtists} missing unique artists`
  )

  const { data, error } = await queryWithRetry<DbTrackRow[]>(
    supabase
      .from('tracks')
      .select(
        'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url, genre'
      )
      .not('spotify_track_id', 'is', null)
      .neq('spotify_track_id', '')
      .limit(fetchLimit) as any,
    undefined,
    'DGS fetchRandomTracksFromDb'
  )

  if (error) {
    logger(
      'WARN',
      `DB fallback: failed to fetch tracks from Supabase`,
      'fetchRandomTracksFromDb',
      error instanceof Error ? error : undefined
    )
    return { tracks: [], uniqueArtistsAdded: 0 }
  }

  const rows = data ?? []
  if (!rows.length) {
    logger('WARN', 'DB fallback: no tracks returned from Supabase')
    return { tracks: [], uniqueArtistsAdded: 0 }
  }

  shuffleInPlace(rows)

  const artistTrackCounts = new Map<string, number>() // Track how many tracks we've added per artist
  const results: TrackDetails[] = []
  let filteredOutCount = 0

  for (const row of rows) {
    if (!row.spotify_track_id) continue

    if (excludeSpotifyTrackIds.has(row.spotify_track_id)) continue

    // If genre missing, queue async backfill (non-blocking)
    if (!row.genre && row.artist) {
      void safeBackfillTrackGenre(
        row.spotify_track_id,
        row.artist,
        null,
        row.popularity ?? null
      )
    }

    const artistName = (row.artist ?? '').trim()
    if (!artistName) continue

    const normalizedArtistName = artistName.toLowerCase()

    // FILTER: Only include tracks whose artist has a profile in the artists table
    const spotifyArtistId = artistProfileMap.get(normalizedArtistName)
    if (!spotifyArtistId) {
      filteredOutCount++
      continue
    }

    // Skip if artist already exists in candidate pool
    if (existingArtistNames.has(normalizedArtistName)) continue

    // Check if we've already added enough tracks for this artist
    const currentCount = artistTrackCounts.get(normalizedArtistName) ?? 0
    if (currentCount >= tracksPerArtist) {
      continue
    }

    const trackName = row.name ?? 'Unknown track'
    const albumName = row.album ?? 'Unknown album'

    const track: TrackDetails = {
      id: row.spotify_track_id,
      uri: `spotify:track:${row.spotify_track_id}`,
      name: trackName,
      duration_ms: row.duration_ms ?? undefined,
      popularity: row.popularity ?? undefined,
      preview_url: null,
      is_playable: true,
      explicit: false,
      album: {
        name: albumName,
        images: [],
        release_date: ''
      },
      artists: [
        {
          id: spotifyArtistId, // NOW SET: Artist ID from the artists table
          name: artistName
        }
      ],
      external_urls: row.spotify_url
        ? {
            spotify: row.spotify_url
          }
        : undefined,
      genre: row.genre ?? undefined
    }

    results.push(track)
    artistTrackCounts.set(normalizedArtistName, currentCount + 1)

    // Stop when we have enough unique artists (each with tracksPerArtist tracks)
    const uniqueArtistsAdded = artistTrackCounts.size
    if (uniqueArtistsAdded >= neededArtists) {
      break
    }
  }

  const uniqueArtistsAdded = artistTrackCounts.size
  logger(
    'INFO',
    `DB fallback: selected ${results.length} tracks for ${uniqueArtistsAdded} unique artists (${tracksPerArtist} tracks per artist, filtered out ${filteredOutCount} unprofiled artists)`
  )

  return {
    tracks: results,
    uniqueArtistsAdded
  }
}

/**
 * Fetch tracks from database by genre and popularity
 * This is the primary source for candidate tracks to minimize Spotify API calls
 * Only returns tracks whose artists are already profiled in the artists table
 */
export async function fetchTracksByGenreFromDb({
  genres,
  minPopularity = 20,
  maxPopularity = 100,
  limit = 100,
  excludeSpotifyTrackIds
}: {
  genres: string[]
  minPopularity?: number
  maxPopularity?: number
  limit?: number
  excludeSpotifyTrackIds: Set<string>
}): Promise<{
  tracks: TrackDetails[]
  uniqueArtists: number
}> {
  if (genres.length === 0) {
    return { tracks: [], uniqueArtists: 0 }
  }

  try {
    // First, get all profiled artists from the artists table
    const { data: profiledArtists, error: artistsError } = await queryWithRetry<
      {
        name: string
        spotify_artist_id: string
      }[]
    >(
      supabase
        .from('artists')
        .select('name, spotify_artist_id')
        .not('spotify_artist_id', 'is', null),
      undefined,
      'DGS fetch profiled artists for genre tracks'
    )

    if (artistsError || !profiledArtists || profiledArtists.length === 0) {
      logger(
        'WARN',
        `DB genre fetch: no profiled artists found in database (${profiledArtists?.length ?? 0} artists)`,
        'fetchTracksByGenreFromDb'
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    // Create a map of normalized artist name -> spotify_artist_id
    const artistProfileMap = new Map<string, string>()
    profiledArtists.forEach((artist) => {
      const normalizedName = (artist.name ?? '').trim().toLowerCase()
      if (normalizedName) {
        artistProfileMap.set(normalizedName, artist.spotify_artist_id)
      }
    })

    logger(
      'INFO',
      `DB genre fetch: ${artistProfileMap.size} profiled artists available for filtering`
    )

    // Query tracks that match any of the provided genres
    // Fetch more than needed since we'll filter by profiled artists
    let query = supabase
      .from('tracks')
      .select(
        'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url, genre'
      )
      .not('spotify_track_id', 'is', null)
      .neq('spotify_track_id', '')
      .gte('popularity', minPopularity)
      .lte('popularity', maxPopularity)
      .limit(limit * 3) // Increased multiplier since we're filtering more

    const { data, error } = await queryWithRetry<DbTrackRow[]>(
      query as any,
      undefined,
      'DGS fetchTracksByGenreFromDb'
    )

    if (error) {
      logger(
        'WARN',
        `Failed to fetch tracks by genre from database`,
        'fetchTracksByGenreFromDb',
        error instanceof Error ? error : undefined
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    const rows = data ?? []
    if (!rows.length) {
      logger(
        'INFO',
        `No tracks found in database for genres: ${genres.join(', ')}`
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    // Filter by genre match, exclusions, and profiled artists
    const genresLower = new Set(genres.map((g) => g.toLowerCase()))
    let filteredOutUnprofiled = 0
    const filtered = rows.filter((row) => {
      if (
        !row.spotify_track_id ||
        excludeSpotifyTrackIds.has(row.spotify_track_id)
      ) {
        return false
      }
      if (!row.genre) {
        if (row.artist) {
          void safeBackfillTrackGenre(
            row.spotify_track_id,
            row.artist,
            null,
            row.popularity ?? null
          )
        }
        return false
      }

      // Check if track genre matches any of the requested genres
      const trackGenreLower = row.genre.toLowerCase()
      const genreMatches =
        genresLower.has(trackGenreLower) ||
        Array.from(genresLower).some(
          (g) => trackGenreLower.includes(g) || g.includes(trackGenreLower)
        )

      if (!genreMatches) return false

      // FILTER: Only include tracks whose artist has a profile
      const artistName = (row.artist ?? '').trim()
      if (!artistName) return false

      const normalizedArtistName = artistName.toLowerCase()
      const hasProfile = artistProfileMap.has(normalizedArtistName)

      if (!hasProfile) {
        filteredOutUnprofiled++
      }

      return hasProfile
    })

    // Shuffle and limit
    shuffleInPlace(filtered)
    const results: TrackDetails[] = []
    const usedArtistNames = new Set<string>()

    for (const row of filtered.slice(0, limit)) {
      const artistName = (row.artist ?? '').trim()
      if (!artistName) continue

      const normalizedArtistName = artistName.toLowerCase()
      const spotifyArtistId = artistProfileMap.get(normalizedArtistName)

      if (!spotifyArtistId) continue // Should not happen due to filtering above, but be safe

      usedArtistNames.add(normalizedArtistName)

      const track: TrackDetails = {
        id: row.spotify_track_id,
        uri: `spotify:track:${row.spotify_track_id}`,
        name: row.name ?? 'Unknown track',
        duration_ms: row.duration_ms ?? undefined,
        popularity: row.popularity ?? undefined,
        preview_url: null,
        is_playable: true,
        explicit: false,
        album: {
          name: row.album ?? 'Unknown album',
          images: [],
          release_date: ''
        },
        artists: [
          {
            id: spotifyArtistId, // NOW SET: Artist ID from the artists table
            name: artistName
          }
        ],
        external_urls: row.spotify_url
          ? {
              spotify: row.spotify_url
            }
          : undefined,
        genre: row.genre ?? undefined
      }

      results.push(track)
    }

    logger(
      'INFO',
      `Fetched ${results.length} tracks from DB for ${usedArtistNames.size} unique artists (genres: ${genres.slice(0, 3).join(', ')}, filtered out ${filteredOutUnprofiled} unprofiled artists)`
    )

    return {
      tracks: results,
      uniqueArtists: usedArtistNames.size
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception fetching tracks by genre from DB`,
      'fetchTracksByGenreFromDb',
      error instanceof Error ? error : undefined
    )
    return { tracks: [], uniqueArtists: 0 }
  }
}

/**
 * Absolute fallback: Get random tracks from database with minimal filtering
 * Guaranteed to return tracks if database has any data
 * Used as last resort when all other discovery methods fail
 */
export async function fetchAbsoluteRandomTracks(
  limit: number,
  excludeTrackIds: Set<string>
): Promise<TrackDetails[]> {
  logger(
    'WARN',
    `Using absolute fallback to fetch ${limit} random tracks (all other methods failed)`,
    'fetchAbsoluteRandomTracks'
  )

  const excludeArray = Array.from(excludeTrackIds)

  const { data, error } = await queryWithRetry<DbTrackRow[]>(
    supabase
      .from('tracks')
      .select('*')
      .not(
        'spotify_track_id',
        'in',
        excludeArray.length > 0 ? excludeArray : ['__never__']
      )
      .gte('popularity', 30) // At least somewhat popular
      .order('popularity', { ascending: false })
      .limit(limit),
    undefined,
    'Absolute fallback random tracks'
  )

  if (error || !data || data.length === 0) {
    logger(
      'ERROR',
      `Absolute fallback failed - database may be empty (${data?.length ?? 0} rows returned)`,
      'fetchAbsoluteRandomTracks',
      error instanceof Error ? error : new Error('Unknown error')
    )
    return []
  }

  // Convert database rows to TrackDetails
  const tracks: TrackDetails[] = []
  for (const row of data) {
    if (!row.spotify_track_id) continue

    const track: TrackDetails = {
      id: row.spotify_track_id,
      uri: `spotify:track:${row.spotify_track_id}`,
      name: row.name ?? 'Unknown track',
      duration_ms: row.duration_ms ?? undefined,
      popularity: row.popularity ?? undefined,
      preview_url: null,
      is_playable: true,
      explicit: false,
      album: {
        name: row.album ?? 'Unknown album',
        images: [],
        release_date: ''
      },
      artists: [
        {
          id: '', // Will be resolved later if needed
          name: row.artist ?? 'Unknown artist'
        }
      ],
      external_urls: row.spotify_url
        ? {
            spotify: row.spotify_url
          }
        : undefined,
      genre: row.genre ?? undefined
    }

    tracks.push(track)
  }

  logger(
    'INFO',
    `Absolute fallback returned ${tracks.length} tracks (requested: ${limit})`,
    'fetchAbsoluteRandomTracks'
  )

  return tracks
}

/**
 * Fetch tracks from database whose artists are closer to target than baseline
 * Database-only query: finds artists with genre overlap with target and higher popularity
 * Only returns tracks whose artists are already profiled in the artists table
 */
export async function fetchTracksCloserToTarget({
  targetGenres,
  targetPopularity,
  excludeArtistIds,
  excludeTrackIds,
  limit
}: {
  targetGenres: string[]
  targetPopularity: number
  excludeArtistIds: Set<string>
  excludeTrackIds: Set<string>
  limit: number
}): Promise<{
  tracks: TrackDetails[]
  uniqueArtists: number
}> {
  // When target has no genres, we can't use genre-based matching
  // Return empty - caller should handle this case (e.g., add target artist itself)
  if (targetGenres.length === 0) {
    logger(
      'WARN',
      `Target has no genres - cannot use genre-based matching. Caller should add target artist itself or use alternative methods.`,
      'fetchTracksCloserToTarget'
    )
    return { tracks: [], uniqueArtists: 0 }
  }

  try {
    // First, get all profiled artists from the artists table
    // For "closer" candidates, we want artists similar to target in multiple dimensions:
    // - Genre overlap (primary)
    // - Similar popularity (secondary)
    // - This increases likelihood of higher attraction score
    const { data: profiledArtists, error: artistsError } = await queryWithRetry<
      {
        name: string
        spotify_artist_id: string
        genres: string[]
        popularity: number | null
      }[]
    >(
      supabase
        .from('artists')
        .select('name, spotify_artist_id, genres, popularity')
        .not('spotify_artist_id', 'is', null)
        .not('genres', 'is', null)
        .gte('popularity', Math.max(0, targetPopularity - 20)) as any, // Wider range to get more candidates
      undefined,
      'DGS fetch profiled artists closer to target'
    )

    if (artistsError || !profiledArtists || profiledArtists.length === 0) {
      logger(
        'WARN',
        `DB closer fetch: no profiled artists found (${profiledArtists?.length ?? 0} artists)`,
        'fetchTracksCloserToTarget'
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    // Filter artists by genre overlap and exclude current artist
    const targetGenresLower = new Set(targetGenres.map((g) => g.toLowerCase()))
    const artistProfileMap = new Map<
      string,
      { id: string; genres: string[]; popularity: number }
    >()

    profiledArtists.forEach((artist) => {
      const normalizedName = (artist.name ?? '').trim().toLowerCase()
      if (!normalizedName) return

      // Exclude current artist
      if (excludeArtistIds.has(artist.spotify_artist_id)) return

      // Check if artist has genre overlap with target
      const artistGenresLower = (artist.genres ?? []).map((g) =>
        g.toLowerCase()
      )
      const hasGenreOverlap = artistGenresLower.some((g) =>
        targetGenresLower.has(g)
      )

      // Also consider popularity similarity as a secondary factor
      // Artists with similar popularity are more likely to have higher attraction
      const artistPopularity = artist.popularity ?? 50
      const popularityDiff = Math.abs(artistPopularity - targetPopularity)
      const hasSimilarPopularity = popularityDiff <= 20 // Within 20 points

      // Include if has genre overlap OR (if no genre overlap but similar popularity and target has few genres)
      // This helps when target has very few genres (like Florence + The Machine with 1 genre)
      const shouldInclude =
        hasGenreOverlap ||
        (targetGenres.length <= 2 &&
          hasSimilarPopularity &&
          artistGenresLower.length > 0)

      if (shouldInclude) {
        artistProfileMap.set(normalizedName, {
          id: artist.spotify_artist_id,
          genres: artist.genres ?? [],
          popularity: artistPopularity
        })
      }
    })

    logger(
      'INFO',
      `DB closer fetch: ${artistProfileMap.size} profiled artists with genre overlap available`
    )

    if (artistProfileMap.size === 0) {
      return { tracks: [], uniqueArtists: 0 }
    }

    // Query tracks - fetch more than needed since we'll filter by profiled artists
    const fetchLimit = limit * 5 // Increased multiplier since we're filtering more

    const { data, error } = await queryWithRetry<DbTrackRow[]>(
      supabase
        .from('tracks')
        .select(
          'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url, genre'
        )
        .not('spotify_track_id', 'is', null)
        .neq('spotify_track_id', '')
        .limit(fetchLimit) as any,
      undefined,
      'DGS fetchTracksCloserToTarget'
    )

    if (error) {
      logger(
        'WARN',
        `Failed to fetch closer tracks from database`,
        'fetchTracksCloserToTarget',
        error instanceof Error ? error : undefined
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    const rows = data ?? []
    if (!rows.length) {
      logger('INFO', `No tracks found in database for closer artists`)
      return { tracks: [], uniqueArtists: 0 }
    }

    // Filter by exclusions and profiled artists, prioritize by popularity
    const filtered = rows
      .filter((row) => {
        if (
          !row.spotify_track_id ||
          excludeTrackIds.has(row.spotify_track_id)
        ) {
          return false
        }
        const artistName = (row.artist ?? '').trim()
        if (!artistName) return false
        return artistProfileMap.has(artistName.toLowerCase())
      })
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)) // Sort by popularity descending

    shuffleInPlace(filtered)
    const results: TrackDetails[] = []
    const usedArtistNames = new Set<string>()

    for (const row of filtered.slice(0, limit)) {
      const artistName = (row.artist ?? '').trim()
      if (!artistName) continue

      const normalizedArtistName = artistName.toLowerCase()
      const artistInfo = artistProfileMap.get(normalizedArtistName)

      if (!artistInfo) continue
      if (usedArtistNames.has(normalizedArtistName)) continue

      usedArtistNames.add(normalizedArtistName)

      const track: TrackDetails = {
        id: row.spotify_track_id,
        uri: `spotify:track:${row.spotify_track_id}`,
        name: row.name ?? 'Unknown track',
        duration_ms: row.duration_ms ?? undefined,
        popularity: row.popularity ?? undefined,
        preview_url: null,
        is_playable: true,
        explicit: false,
        album: {
          name: row.album ?? 'Unknown album',
          images: [],
          release_date: ''
        },
        artists: [
          {
            id: artistInfo.id,
            name: artistName
          }
        ],
        external_urls: row.spotify_url
          ? {
              spotify: row.spotify_url
            }
          : undefined,
        genre: row.genre ?? undefined
      }

      results.push(track)
    }

    logger(
      'INFO',
      `Fetched ${results.length} closer tracks from DB for ${usedArtistNames.size} unique artists`
    )

    return {
      tracks: results,
      uniqueArtists: usedArtistNames.size
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception fetching closer tracks from DB`,
      'fetchTracksCloserToTarget',
      error instanceof Error ? error : undefined
    )
    return { tracks: [], uniqueArtists: 0 }
  }
}

/**
 * Fetch tracks from database whose artists are further from target than baseline
 * Database-only query: finds artists with genres different from target
 * Only returns tracks whose artists are already profiled in the artists table
 */
export async function fetchTracksFurtherFromTarget({
  targetGenres,
  excludeArtistIds,
  excludeTrackIds,
  limit
}: {
  targetGenres: string[]
  excludeArtistIds: Set<string>
  excludeTrackIds: Set<string>
  limit: number
}): Promise<{
  tracks: TrackDetails[]
  uniqueArtists: number
}> {
  try {
    // First, get all profiled artists from the artists table
    const { data: profiledArtists, error: artistsError } = await queryWithRetry<
      {
        name: string
        spotify_artist_id: string
        genres: string[]
        popularity: number | null
      }[]
    >(
      supabase
        .from('artists')
        .select('name, spotify_artist_id, genres, popularity')
        .not('spotify_artist_id', 'is', null)
        .not('genres', 'is', null) as any,
      undefined,
      'DGS fetch profiled artists for further tracks'
    )

    if (artistsError || !profiledArtists || profiledArtists.length === 0) {
      logger(
        'WARN',
        `DB further fetch: no profiled artists found (${profiledArtists?.length ?? 0} artists)`,
        'fetchTracksFurtherFromTarget'
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    // Filter artists by genre difference (low overlap with target)
    const targetGenresLower = new Set(targetGenres.map((g) => g.toLowerCase()))
    const artistProfileMap = new Map<string, { id: string; genres: string[] }>()

    profiledArtists.forEach((artist) => {
      const normalizedName = (artist.name ?? '').trim().toLowerCase()
      if (!normalizedName) return

      // Exclude current artist
      if (excludeArtistIds.has(artist.spotify_artist_id)) return

      // Check genre overlap - we want LOW overlap (different genres)
      const artistGenresLower = (artist.genres ?? []).map((g) =>
        g.toLowerCase()
      )
      const overlapCount = artistGenresLower.filter((g) =>
        targetGenresLower.has(g)
      ).length
      const totalGenres = Math.max(artistGenresLower.length, 1)
      const overlapRatio = overlapCount / totalGenres

      // Only include if overlap is less than 50% (different enough)
      if (overlapRatio < 0.5) {
        artistProfileMap.set(normalizedName, {
          id: artist.spotify_artist_id,
          genres: artist.genres ?? []
        })
      }
    })

    logger(
      'INFO',
      `DB further fetch: ${artistProfileMap.size} profiled artists with different genres available`
    )

    if (artistProfileMap.size === 0) {
      return { tracks: [], uniqueArtists: 0 }
    }

    // Query tracks - fetch more than needed since we'll filter by profiled artists
    const fetchLimit = limit * 5 // Increased multiplier since we're filtering more

    const { data, error } = await queryWithRetry<DbTrackRow[]>(
      supabase
        .from('tracks')
        .select(
          'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url, genre'
        )
        .not('spotify_track_id', 'is', null)
        .neq('spotify_track_id', '')
        .limit(fetchLimit) as any,
      undefined,
      'DGS fetchTracksFurtherFromTarget'
    )

    if (error) {
      logger(
        'WARN',
        `Failed to fetch further tracks from database`,
        'fetchTracksFurtherFromTarget',
        error instanceof Error ? error : undefined
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    const rows = data ?? []
    if (!rows.length) {
      logger('INFO', `No tracks found in database for further artists`)
      return { tracks: [], uniqueArtists: 0 }
    }

    // Filter by exclusions and profiled artists
    const filtered = rows.filter((row) => {
      if (!row.spotify_track_id || excludeTrackIds.has(row.spotify_track_id)) {
        return false
      }
      const artistName = (row.artist ?? '').trim()
      if (!artistName) return false
      return artistProfileMap.has(artistName.toLowerCase())
    })

    shuffleInPlace(filtered)
    const results: TrackDetails[] = []
    const usedArtistNames = new Set<string>()

    for (const row of filtered.slice(0, limit)) {
      const artistName = (row.artist ?? '').trim()
      if (!artistName) continue

      const normalizedArtistName = artistName.toLowerCase()
      const artistInfo = artistProfileMap.get(normalizedArtistName)

      if (!artistInfo) continue
      if (usedArtistNames.has(normalizedArtistName)) continue

      usedArtistNames.add(normalizedArtistName)

      const track: TrackDetails = {
        id: row.spotify_track_id,
        uri: `spotify:track:${row.spotify_track_id}`,
        name: row.name ?? 'Unknown track',
        duration_ms: row.duration_ms ?? undefined,
        popularity: row.popularity ?? undefined,
        preview_url: null,
        is_playable: true,
        explicit: false,
        album: {
          name: row.album ?? 'Unknown album',
          images: [],
          release_date: ''
        },
        artists: [
          {
            id: artistInfo.id,
            name: artistName
          }
        ],
        external_urls: row.spotify_url
          ? {
              spotify: row.spotify_url
            }
          : undefined,
        genre: row.genre ?? undefined
      }

      results.push(track)
    }

    logger(
      'INFO',
      `Fetched ${results.length} further tracks from DB for ${usedArtistNames.size} unique artists`
    )

    return {
      tracks: results,
      uniqueArtists: usedArtistNames.size
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception fetching further tracks from DB`,
      'fetchTracksFurtherFromTarget',
      error instanceof Error ? error : undefined
    )
    return { tracks: [], uniqueArtists: 0 }
  }
}

/**
 * Upsert track details to database after fetching from Spotify
 * This populates the tracks table with full track metadata
 */
export async function upsertTrackDetails(
  tracks: TrackDetails[]
): Promise<void> {
  if (tracks.length === 0) return

  try {
    // Filter out tracks with missing or empty critical metadata
    const validTracks = tracks.filter((track) => {
      const trackId = track.id?.trim()
      const trackName = track.name?.trim()
      const artistName = track.artists?.[0]?.name?.trim()

      if (!trackId || !trackName || !artistName) {
        logger(
          'WARN',
          `Skipping track with missing/empty critical data - ID: "${track.id ?? 'missing'}", Name: "${track.name ?? 'missing'}", Artist: "${track.artists?.[0]?.name ?? 'missing'}"`,
          'upsertTrackDetails'
        )
        return false
      }
      return true
    })

    if (validTracks.length === 0) {
      logger(
        'WARN',
        'No valid tracks to upsert after filtering',
        'upsertTrackDetails'
      )
      return
    }

    // Only include fields with valid data - never overwrite existing metadata with null
    const rows = validTracks.map((track) => ({
      spotify_track_id: track.id.trim(),
      name: track.name.trim(),
      artist: track.artists[0].name.trim(),
      album: track.album?.name?.trim() ?? 'Unknown',
      duration_ms: track.duration_ms ?? 0,
      popularity: track.popularity ?? 0,
      spotify_url: track.external_urls?.spotify
      // genre and release_year intentionally omitted - will be enriched by MusicBrainz if missing
    }))

    const { error } = await supabase
      .from('tracks')
      .upsert(rows, { onConflict: 'spotify_track_id' })

    if (error) {
      logger(
        'WARN',
        `Failed to upsert ${validTracks.length} track details to database`,
        'upsertTrackDetails',
        error as Error
      )
    } else {
      const skippedCount = tracks.length - validTracks.length
      if (skippedCount > 0) {
        logger(
          'INFO',
          `Upserted ${validTracks.length} track details to database (skipped ${skippedCount} invalid tracks)`
        )
      } else {
        logger(
          'INFO',
          `Upserted ${validTracks.length} track details to database`
        )
      }

      // Fire-and-forget backfill for potentially missing metadata
      // (MusicBrainz release year, genres, popularity check)
      // We rate limit this by processing only distinct tracks and handling them safely
      validTracks.forEach((track) => {
        // We pass no token here, so it uses app token
        void safeBackfillTrackDetails(
          track.id,
          track.artists[0].name,
          track.name
        ).catch((e) =>
          logger(
            'WARN',
            `Background backfill trigger failed for ${track.id}`,
            undefined,
            e
          )
        )
      })
    }
  } catch (error) {
    logger(
      'WARN',
      'Exception upserting track details',
      'upsertTrackDetails',
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Get genre statistics from the tracks table
 * Returns total tracks, tracks with null genres, tracks with genres, and percentage coverage
 */
export async function getGenreStatistics(): Promise<{
  totalTracks: number
  tracksWithNullGenres: number
  tracksWithGenres: number
  percentageCoverage: number
}> {
  try {
    // Get total count of tracks
    const { count: totalCount, error: totalError } = await queryWithRetry(
      supabase.from('tracks').select('*', { count: 'exact', head: true }),
      undefined,
      'Get total tracks count for genre statistics'
    )

    if (totalError) {
      logger(
        'WARN',
        'Failed to get total tracks count for genre statistics',
        'getGenreStatistics',
        totalError instanceof Error ? totalError : undefined
      )
      return {
        totalTracks: 0,
        tracksWithNullGenres: 0,
        tracksWithGenres: 0,
        percentageCoverage: 0
      }
    }

    const totalTracks = totalCount ?? 0

    // Get count of tracks with null or empty genres
    const { count: nullCount, error: nullError } = await queryWithRetry(
      supabase
        .from('tracks')
        .select('*', { count: 'exact', head: true })
        .or('genre.is.null,genre.eq.'),
      undefined,
      'Get null genre tracks count for genre statistics'
    )

    if (nullError) {
      logger(
        'WARN',
        'Failed to get null genre tracks count for genre statistics',
        'getGenreStatistics',
        nullError instanceof Error ? nullError : undefined
      )
      return {
        totalTracks,
        tracksWithNullGenres: 0,
        tracksWithGenres: 0,
        percentageCoverage: 0
      }
    }

    const tracksWithNullGenres = nullCount ?? 0
    const tracksWithGenres = totalTracks - tracksWithNullGenres
    const percentageCoverage =
      totalTracks > 0 ? (tracksWithGenres / totalTracks) * 100 : 0

    return {
      totalTracks,
      tracksWithNullGenres,
      tracksWithGenres,
      percentageCoverage
    }
  } catch (error) {
    logger(
      'WARN',
      'Exception getting genre statistics',
      'getGenreStatistics',
      error instanceof Error ? error : undefined
    )
    return {
      totalTracks: 0,
      tracksWithNullGenres: 0,
      tracksWithGenres: 0,
      percentageCoverage: 0
    }
  }
}

/**
 * Fetch tracks from database for specific artist IDs
 * Used to force insertion of target-related artist tracks
 */
export async function fetchTracksByArtistIdsFromDb({
  artistIds,
  limit = 20,
  excludeTrackIds
}: {
  artistIds: string[]
  limit?: number
  excludeTrackIds: Set<string>
}): Promise<{
  tracks: TrackDetails[]
  uniqueArtists: number
}> {
  if (artistIds.length === 0) {
    return { tracks: [], uniqueArtists: 0 }
  }

  try {
    // 1. Resolve Artist IDs to Names using artists table
    const { data: artists, error: artistsError } = await queryWithRetry<
      {
        name: string
        spotify_artist_id: string
      }[]
    >(
      supabase
        .from('artists')
        .select('name, spotify_artist_id')
        .in('spotify_artist_id', artistIds),
      undefined,
      'DGS fetch artist names for IDs'
    )

    if (artistsError || !artists || artists.length === 0) {
      logger(
        'WARN',
        `DB artist fetch: no artists found for IDs (${artistIds.length} requested)`,
        'fetchTracksByArtistIdsFromDb'
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    const artistNames = artists.map((a) => a.name).filter(Boolean)
    const artistProfileMap = new Map<string, string>()
    artists.forEach((a) => {
      if (a.name)
        artistProfileMap.set(a.name.toLowerCase().trim(), a.spotify_artist_id)
    })

    if (artistNames.length === 0) {
      return { tracks: [], uniqueArtists: 0 }
    }

    // 2. Query tracks matching these artist names
    // Fetch more than limit to allow for filtering
    const fetchLimit = limit * 3

    const { data, error } = await queryWithRetry<DbTrackRow[]>(
      supabase
        .from('tracks')
        .select(
          'id, spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url, genre'
        )
        .not('spotify_track_id', 'is', null)
        .neq('spotify_track_id', '')
        .in('artist', artistNames) // This assumes exact match, which is likely for Spotify-sourced data
        .limit(fetchLimit) as any,
      undefined,
      'DGS fetchTracksByArtistIdsFromDb'
    )

    if (error) {
      logger(
        'WARN',
        `Failed to fetch tracks by artist IDs from database`,
        'fetchTracksByArtistIdsFromDb',
        error instanceof Error ? error : undefined
      )
      return { tracks: [], uniqueArtists: 0 }
    }

    const rows = data ?? []
    if (!rows.length) {
      logger('INFO', `No tracks found in database for provided related artists`)
      return { tracks: [], uniqueArtists: 0 }
    }

    // Filter and map
    const results: TrackDetails[] = []
    const usedArtistNames = new Set<string>()

    shuffleInPlace(rows)

    for (const row of rows) {
      if (!row.spotify_track_id || excludeTrackIds.has(row.spotify_track_id))
        continue

      const artistName = (row.artist ?? '').trim()
      if (!artistName) continue

      const normalizedArtistName = artistName.toLowerCase()
      // Ensure it maps back to one of our requested IDs (it should given the query)
      const spotifyArtistId = artistProfileMap.get(normalizedArtistName)
      if (!spotifyArtistId) continue

      usedArtistNames.add(normalizedArtistName)

      results.push({
        id: row.spotify_track_id,
        uri: `spotify:track:${row.spotify_track_id}`,
        name: row.name ?? 'Unknown track',
        duration_ms: row.duration_ms ?? undefined,
        popularity: row.popularity ?? undefined,
        preview_url: null,
        is_playable: true,
        explicit: false,
        album: {
          name: row.album ?? 'Unknown album',
          images: [],
          release_date: ''
        },
        artists: [
          {
            id: spotifyArtistId,
            name: artistName
          }
        ],
        external_urls: row.spotify_url
          ? {
              spotify: row.spotify_url
            }
          : undefined,
        genre: row.genre ?? undefined
      })

      if (results.length >= limit) break
    }

    logger(
      'INFO',
      `Fetched ${results.length} related artist tracks from DB for ${usedArtistNames.size} unique artists`
    )

    return {
      tracks: results,
      uniqueArtists: usedArtistNames.size
    }
  } catch (error) {
    logger(
      'WARN',
      `Exception fetching tracks by artist IDs from DB`,
      'fetchTracksByArtistIdsFromDb',
      error instanceof Error ? error : undefined
    )
    return { tracks: [], uniqueArtists: 0 }
  }
}
