import { TrackDetails } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import {
  FALLBACK_GENRES,
  MIN_TRACK_POPULARITY,
  SPOTIFY_SEARCH_ENDPOINT,
  TRACK_SEARCH_LIMIT,
  DEFAULT_MARKET,
  DEFAULT_MAX_SONG_LENGTH_MINUTES,
  DEFAULT_MAX_OFFSET,
  DEFAULT_MAX_GENRE_ATTEMPTS,
  DEFAULT_YEAR_RANGE,
  type Genre
} from '@/shared/constants/trackSuggestion'
import {
  validateTrackSuggestionParams,
  validateExcludedTrackIds
} from '@/shared/validations/trackSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'

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
  allowExplicit: boolean
}

// Track filtering result interface
interface TrackFilterResult {
  candidates: TrackDetails[]
  filteredOut: {
    excluded: number
    lowPopularity: number
    tooLong: number
    explicit: number
    unplayable: number
  }
}

// Utility: Select a random track from a filtered list
export function selectRandomTrack(
  tracks: TrackDetails[],
  excludedIds: string[],
  minPopularity: number,
  maxSongLength: number, // maxSongLength is in minutes
  allowExplicit: boolean
): TrackDetails | null {
  const maxDurationMs = maxSongLength * 60 * 1000 // Convert minutes to milliseconds

  const filterResult = filterTracksByCriteria(tracks, {
    excludedIds,
    minPopularity,
    maxSongLengthMs: maxDurationMs,
    allowExplicit
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
  const { excludedIds, minPopularity, maxSongLengthMs, allowExplicit } =
    criteria

  const candidates: TrackDetails[] = []
  const filteredOut = {
    excluded: 0,
    lowPopularity: 0,
    tooLong: 0,
    explicit: 0,
    unplayable: 0
  }

  for (const track of tracks) {
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

    // Log invalid popularity values for debugging
    if (typeof track.popularity !== 'number' || isNaN(track.popularity)) {
      logger(
        'WARN',
        `Invalid popularity value for track ${track.name} (${track.id}): ${track.popularity}`
      )
    }

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

    // Check explicit content
    if (!allowExplicit && track.explicit) {
      filteredOut.explicit++
      continue
    }

    // Track passes all criteria
    candidates.push(track)
  }

  return { candidates, filteredOut }
}

export async function searchTracksByGenre(
  genre: string,
  yearRange: [number, number],
  market: string = DEFAULT_MARKET,
  minPopularity: number = MIN_TRACK_POPULARITY,
  maxOffset: number = DEFAULT_MAX_OFFSET
): Promise<TrackDetails[]> {
  try {
    const [startYear, endYear] = yearRange
    const randomOffset = Math.floor(Math.random() * maxOffset)

    const response = await sendApiRequest<{
      tracks: { items: TrackDetails[] }
    }>({
      path: `${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)} year:${startYear}-${endYear}&type=track&limit=${TRACK_SEARCH_LIMIT}&market=${market}&offset=${randomOffset}`,
      method: 'GET'
    })

    const tracks = response.tracks?.items
    if (!Array.isArray(tracks)) {
      throw new Error('Unexpected API response format')
    }

    return tracks
  } catch (error) {
    logger(
      'ERROR',
      `Error searching tracks for genre ${genre}`,
      undefined,
      error instanceof Error ? error : new Error('Unknown error')
    )
    throw error
  }
}

export function getRandomGenre(genres: Genre[]): Genre {
  if (!Array.isArray(genres) || genres.length === 0) {
    throw new Error('Genres array must be non-empty')
  }
  return genres[Math.floor(Math.random() * genres.length)]
}

// Utility: Get a random genre that hasn't been tried yet
function getUntriedGenre(genres: Genre[], triedGenres: string[]): Genre | null {
  const untriedGenres = genres.filter((genre) => !triedGenres.includes(genre))
  if (untriedGenres.length === 0) {
    return null
  }
  return getRandomGenre(untriedGenres)
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
      explicit: boolean
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
    allowExplicit: boolean
    maxSongLength: number // maxSongLength is in minutes
    songsBetweenRepeats: number
    maxOffset: number
  }
): Promise<TrackSearchResult> {
  // Validate inputs
  const excludedValidation = validateExcludedTrackIds(excludedTrackIds)
  if (!excludedValidation.isValid) {
    throw new Error(
      `Invalid excluded track IDs: ${excludedValidation.errors.join(', ')}`
    )
  }

  if (params) {
    const paramsValidation = validateTrackSuggestionParams(params)
    if (!paramsValidation.isValid) {
      throw new Error(
        `Invalid parameters: ${paramsValidation.errors.join(', ')}`
      )
    }
  }

  let attempts = 0
  const genresTried: string[] = []
  const allTrackDetails: Array<{
    name: string
    popularity: number
    isExcluded: boolean
    isPlayable: boolean
    duration_ms: number
    explicit: boolean
  }> = []

  // Add current track to excluded IDs if provided
  const allExcludedIds = currentTrackId
    ? [...excludedTrackIds, currentTrackId]
    : excludedTrackIds

  // Use provided genres or fallback to FALLBACK_GENRES
  const genres = params?.genres?.length ? params.genres : [...FALLBACK_GENRES]

  const yearRange = params?.yearRange ?? DEFAULT_YEAR_RANGE
  const minPopularity = params?.popularity ?? MIN_TRACK_POPULARITY
  const allowExplicit = params?.allowExplicit ?? false
  const maxSongLength = params?.maxSongLength ?? DEFAULT_MAX_SONG_LENGTH_MINUTES
  const maxOffset = params?.maxOffset ?? DEFAULT_MAX_OFFSET

  while (attempts < DEFAULT_MAX_GENRE_ATTEMPTS) {
    // Try to get an untried genre first, fallback to random if all tried
    const genre = getUntriedGenre(genres, genresTried) ?? getRandomGenre(genres)
    genresTried.push(genre)

    try {
      const tracks = await searchTracksByGenre(
        genre,
        yearRange,
        market,
        minPopularity,
        maxOffset
      )

      // Log details about the tracks we found
      const trackDetails = tracks.map((t) => ({
        name: t.name,
        popularity:
          typeof t.popularity === 'number' && !isNaN(t.popularity)
            ? t.popularity
            : 0,
        isExcluded: allExcludedIds.includes(t.id),
        isPlayable: t.is_playable,
        duration_ms: t.duration_ms,
        explicit: t.explicit
      }))
      allTrackDetails.push(...trackDetails)

      const selectedTrack = selectRandomTrack(
        tracks,
        allExcludedIds,
        minPopularity,
        maxSongLength,
        allowExplicit
      )

      // Count how many tracks meet each criteria using the filter function
      const filterResult = filterTracksByCriteria(tracks, {
        excludedIds: allExcludedIds,
        minPopularity,
        maxSongLengthMs: maxSongLength * 60 * 1000,
        allowExplicit
      })

      if (selectedTrack) {
        return {
          track: selectedTrack,
          searchDetails: {
            attempts: attempts + 1,
            totalTracksFound: allTrackDetails.length,
            excludedTrackIds: allExcludedIds,
            minPopularity,
            genresTried,
            trackDetails: allTrackDetails
          }
        }
      }

      // Log when no suitable track is found for this genre
      // Calculate highest popularity found for this genre
      const popularityValues = tracks.map((t) =>
        typeof t.popularity === 'number' && !isNaN(t.popularity)
          ? t.popularity
          : 0
      )
      const highestPopularity =
        tracks.length > 0 ? Math.max(...popularityValues) : 0

      logger(
        'WARN',
        `No suitable track found for genre "${genre}" - ${filterResult.candidates.length} candidates out of ${tracks.length} total tracks (highest popularity: ${highestPopularity})`
      )

      attempts++
      if (attempts < DEFAULT_MAX_GENRE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      logger(
        'ERROR',
        `Error searching tracks for genre "${genre}"`,
        undefined,
        error instanceof Error ? error : new Error('Unknown error')
      )
      attempts++
      if (attempts < DEFAULT_MAX_GENRE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  logger(
    'ERROR',
    `Failed to find suitable track after ${DEFAULT_MAX_GENRE_ATTEMPTS} attempts`
  )

  return {
    track: null,
    searchDetails: {
      attempts,
      totalTracksFound: allTrackDetails.length,
      excludedTrackIds: allExcludedIds,
      minPopularity,
      genresTried,
      trackDetails: allTrackDetails
    }
  }
}
