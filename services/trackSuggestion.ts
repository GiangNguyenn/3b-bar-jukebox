import { TrackDetails } from '@/shared/types/spotify'
import {
  FALLBACK_GENRES,
  MIN_TRACK_POPULARITY,
  DEFAULT_MARKET,
  DEFAULT_MAX_SONG_LENGTH_MINUTES,
  DEFAULT_YEAR_RANGE,
  type Genre
} from '@/shared/constants/trackSuggestion'
import {
  validateTrackSuggestionParams,
  validateExcludedTrackIds
} from '@/shared/validations/trackSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'
import { safeBackfillTrackGenre } from '@/services/game/genreBackfill'

// Set up logger for this module
const logger = createModuleLogger('TrackSuggestion')

// Function to set the logging function (for compatibility with existing pattern)
export function setTrackSuggestionLogger(loggerFn: typeof logger) {
  // This function is kept for compatibility but the logger is already set up
}

// Track filtering criteria interface
interface TrackFilterCriteria {
  excludedIds: string[]
  minPopularity: number
  maxSongLengthMs: number
  yearRange?: [number, number]
}

// Track filtering result interface
interface TrackFilterResult {
  candidates: TrackDetails[]
  filteredOut: {
    excluded: number
    lowPopularity: number
    tooLong: number
    unplayable: number
    wrongYear: number
  }
}

// Utility: Select a random track from a filtered list
export function selectRandomTrack(
  tracks: TrackDetails[],
  excludedIds: string[],
  minPopularity: number,
  maxSongLength: number // maxSongLength is in minutes
): TrackDetails | null {
  const maxDurationMs = maxSongLength * 60 * 1000 // Convert minutes to milliseconds

  const filterResult = filterTracksByCriteria(tracks, {
    excludedIds,
    minPopularity,
    maxSongLengthMs: maxDurationMs
  })

  if (filterResult.candidates.length === 0) {
    return null
  }

  const randomIndex = Math.floor(Math.random() * filterResult.candidates.length)
  return filterResult.candidates[randomIndex]
}

// Utility: Filter tracks by multiple criteria efficiently
function filterTracksByCriteria(
  tracks: TrackDetails[],
  criteria: TrackFilterCriteria
): TrackFilterResult {
  const { excludedIds, minPopularity, maxSongLengthMs, yearRange } = criteria

  logger(
    'INFO',
    `[filterTracksByCriteria] Filtering ${tracks.length} candidates. Criteria: ` +
      `Excluded=${excludedIds.length}, MinPop=${minPopularity}, MaxLen=${maxSongLengthMs}ms, YearRange=${yearRange ?? 'None'}`
  )

  const candidates: TrackDetails[] = []
  const filteredOut = {
    excluded: 0,
    lowPopularity: 0,
    tooLong: 0,
    unplayable: 0,
    wrongYear: 0
  }

  for (const track of tracks) {
    const trackInfo = `${track.name} by ${track.artists.map((a) => a.name).join(', ')} (${track.id})`

    // Check exclusion first (most restrictive)
    if (excludedIds.includes(track.id)) {
      filteredOut.excluded++
      continue
    }

    // Check playability
    if (track.is_playable !== true) {
      filteredOut.unplayable++
      continue
    }

    // Validate and handle popularity value
    const trackPopularity =
      typeof track.popularity === 'number' && !isNaN(track.popularity)
        ? track.popularity
        : 0

    // Check popularity
    if (trackPopularity < minPopularity) {
      filteredOut.lowPopularity++
      continue
    }

    // Check length
    if (track.duration_ms > maxSongLengthMs) {
      filteredOut.tooLong++
      continue
    }

    // Check year range if provided (secondary validation)
    if (yearRange) {
      const [startYear, endYear] = yearRange
      // Handle different release_date formats: "YYYY", "YYYY-MM", or "YYYY-MM-DD"
      let releaseYear: number
      if (!track.album.release_date) {
        // If no release date, skip year validation (or fail it?)
        // The DB query handles major filtering, this handles edge cases.
        // If DB query enforced year range, we expect tracks to match or have passed the query.
        // However, standard safety: if unknown, we might keep it or drop it.
        // Currently logic: startYear (keep it)
        releaseYear = startYear
      } else {
        try {
          // Try parsing the year from various date formats
          const dateStr = track.album.release_date
          if (dateStr.includes('-')) {
            releaseYear = parseInt(dateStr.split('-')[0], 10)
          } else {
            releaseYear = parseInt(dateStr, 10)
          }
          // Validate parsed year is a valid number
          if (isNaN(releaseYear)) {
            releaseYear = startYear // Use startYear so it passes validation
          }
        } catch {
          // If parsing fails, skip year validation for this track
          releaseYear = startYear
        }
      }

      if (releaseYear < startYear || releaseYear > endYear) {
        // Only log specific failures if result set is small
        if (tracks.length <= 5) {
          logger(
            'INFO',
            `[Filter] Track ${trackInfo} excluded by year. Year=${releaseYear}, Range=[${startYear}, ${endYear}]`
          )
        }
        filteredOut.wrongYear++
        continue
      }
    }

    // Track passes all criteria
    candidates.push(track)
  }

  logger(
    'INFO',
    `[filterTracksByCriteria] Result: ${candidates.length} passed. ` +
      `Filtered: Excluded=${filteredOut.excluded}, LowPop=${filteredOut.lowPopularity}, ` +
      `TooLong=${filteredOut.tooLong}, Unplayable=${filteredOut.unplayable}, WrongYear=${filteredOut.wrongYear}`
  )

  return { candidates, filteredOut }
}

export function getRandomGenre(genres: Genre[]): Genre {
  if (!Array.isArray(genres) || genres.length === 0) {
    throw new Error('Genres array must be non-empty')
  }
  return genres[Math.floor(Math.random() * genres.length)]
}

export interface TrackSearchResult {
  track: TrackDetails | null
  searchDetails: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails: Array<{
      name: string
      popularity: number
      isExcluded: boolean
      isPlayable: boolean
      duration_ms: number
    }>
  }
}

export async function findSuggestedTrack(
  excludedTrackIds: string[],
  currentTrackId?: string | null,
  market: string = DEFAULT_MARKET,
  params?: {
    genres: Genre[]
    yearRange: [number, number]
    popularity: number
    maxSongLength: number // maxSongLength is in minutes
  },
  useAppToken: boolean = false
): Promise<TrackSearchResult> {
  // Validate inputs
  const excludedValidation = validateExcludedTrackIds(excludedTrackIds)
  if (!excludedValidation.isValid) {
    logger(
      'ERROR',
      `[findSuggestedTrack] Invalid excluded track IDs: ${excludedValidation.errors.join(', ')}`
    )
    throw new Error(
      `Invalid excluded track IDs: ${excludedValidation.errors.join(', ')}`
    )
  }

  const allExcludedIds = currentTrackId
    ? [...excludedTrackIds, currentTrackId]
    : excludedTrackIds

  // Use provided genres or fallback to FALLBACK_GENRES
  const genres = params?.genres?.length ? params.genres : [...FALLBACK_GENRES]
  const yearRange = params?.yearRange ?? DEFAULT_YEAR_RANGE
  const minPopularity = params?.popularity ?? MIN_TRACK_POPULARITY
  const maxSongLength = params?.maxSongLength ?? DEFAULT_MAX_SONG_LENGTH_MINUTES

  logger(
    'INFO',
    `[findSuggestedTrack] Starting search. Params: ` +
      `Genres=[${genres.join(', ')}], YearRange=${yearRange}, MinPop=${minPopularity}, ` +
      `MaxLen=${maxSongLength}m, ExcludedCount=${allExcludedIds.length}`
  )

  // Database-only approach
  try {
    const { supabase } = await import('@/lib/supabase')
    const maxDurationMs = maxSongLength * 60 * 1000

    // Build query for database tracks matching criteria
    let dbQuery = supabase
      .from('tracks')
      // Note: Supabase/Postgres random ordering
      .select(
        'spotify_track_id, name, artist, album, popularity, duration_ms, spotify_url, genre, release_year'
      )
      .gte('popularity', minPopularity)
      .lte('duration_ms', maxDurationMs)
      .not('spotify_track_id', 'in', `(${allExcludedIds.join(',')})`)

    // Filter by genre if we have specific genres
    if (genres.length > 0) {
      // Use OR condition for multiple genres
      const genreFilters = genres.map((g) => `genre.ilike.%${g}%`).join(',')
      dbQuery = dbQuery.or(genreFilters)
    }

    // Filter by year range
    if (yearRange) {
      const [startYear, endYear] = yearRange
      dbQuery = dbQuery
        .gte('release_year', startYear)
        .lte('release_year', endYear)
    }

    // Fetch random tracks
    const { data: dbTracks, error } = await dbQuery.limit(50) // Get top 50 matches (limit is necessary for performance)

    if (error) {
      throw error
    }

    logger(
      'INFO',
      `[findSuggestedTrack] DB Query result: Found ${dbTracks?.length ?? 0} tracks matching criteria before client-side filtering.`
    )

    // Log sample if empty to help debugging
    if (!dbTracks || dbTracks.length === 0) {
      logger(
        'WARN',
        '[findSuggestedTrack] No tracks found. This usually means filters are too strict (e.g. year range vs NULL years in DB).'
      )
    }

    // Queue async backfill for any tracks missing genres
    dbTracks?.forEach((track) => {
      if (!track.genre && track.artist) {
        void safeBackfillTrackGenre(
          track.spotify_track_id,
          track.artist,
          track.release_year ?? null,
          track.popularity ?? null
        )
      }
    })

    if (dbTracks && dbTracks.length > 0) {
      // Convert to TrackDetails format
      const dbTrackDetails: TrackDetails[] = dbTracks.map((track) => ({
        id: track.spotify_track_id,
        uri: track.spotify_url ?? `spotify:track:${track.spotify_track_id}`,
        name: track.name,
        duration_ms: track.duration_ms,
        popularity: track.popularity,
        preview_url: null,
        is_playable: true,
        explicit: false,
        album: {
          name: track.album,
          images: [],
          release_date: track.release_year?.toString() ?? ''
        },
        artists: [{ id: '', name: track.artist }]
      }))

      // Select random track from DB results
      const selectedTrack = selectRandomTrack(
        dbTrackDetails,
        allExcludedIds,
        minPopularity,
        maxSongLength
      )

      if (selectedTrack) {
        logger(
          'INFO',
          `Successfully selected track from database: ${selectedTrack.name}`
        )
        return {
          track: selectedTrack,
          searchDetails: {
            attempts: 1,
            totalTracksFound: dbTracks.length,
            excludedTrackIds: allExcludedIds,
            minPopularity,
            genresTried: genres as string[],
            trackDetails: dbTrackDetails.map((t) => ({
              name: t.name,
              popularity: t.popularity,
              isExcluded: allExcludedIds.includes(t.id),
              isPlayable: t.is_playable,
              duration_ms: t.duration_ms
            }))
          }
        }
      } else {
        // This case happens if selectRandomTrack filtered everything out
        logger(
          'WARN',
          'All DB candidates were filtered out by client-side criteria'
        )
      }
    } else {
      logger('INFO', `DB search returned 0 tracks`)
    }
  } catch (dbError) {
    logger(
      'ERROR',
      `Database search failed`,
      undefined,
      dbError instanceof Error ? dbError : undefined
    )
  }

  logger(
    'WARN',
    `[findSuggestedTrack] Failed to find suitable track in database`
  )

  return {
    track: null,
    searchDetails: {
      attempts: 1,
      totalTracksFound: 0,
      excludedTrackIds: allExcludedIds,
      minPopularity,
      genresTried: genres as string[],
      trackDetails: []
    }
  }
}
