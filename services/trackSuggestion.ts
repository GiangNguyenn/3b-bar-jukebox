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
  yearRange?: [number, number]
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
    wrongYear: number
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
  const {
    excludedIds,
    minPopularity,
    maxSongLengthMs,
    allowExplicit,
    yearRange
  } = criteria

  logger(
    'INFO',
    `[filterTracksByCriteria] Starting filter with ${tracks.length} tracks and criteria: ${JSON.stringify(
      {
        excludedIdsCount: excludedIds.length,
        minPopularity,
        maxSongLengthMs,
        allowExplicit,
        yearRange
      }
    )}`
  )

  const candidates: TrackDetails[] = []
  const filteredOut = {
    excluded: 0,
    lowPopularity: 0,
    tooLong: 0,
    explicit: 0,
    unplayable: 0,
    wrongYear: 0
  }

  for (const track of tracks) {
    const trackInfo = `${track.name} by ${track.artists.map((a) => a.name).join(', ')} (${track.id})`

    // Check exclusion first (most restrictive)
    if (excludedIds.includes(track.id)) {
      filteredOut.excluded++
      logger('INFO', `[filterTracksByCriteria] Track excluded: ${trackInfo}`)
      continue
    }

    // Check playability
    if (track.is_playable !== true) {
      filteredOut.unplayable++
      logger('INFO', `[filterTracksByCriteria] Track unplayable: ${trackInfo}`)
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
        `[filterTracksByCriteria] Invalid popularity value for track ${trackInfo}: ${track.popularity}`
      )
    }

    // Check popularity
    if (trackPopularity < minPopularity) {
      filteredOut.lowPopularity++
      logger(
        'INFO',
        `[filterTracksByCriteria] Track low popularity (${trackPopularity} < ${minPopularity}): ${trackInfo}`
      )
      continue
    }

    // Check length
    const trackLengthMinutes =
      Math.round((track.duration_ms / 1000 / 60) * 10) / 10
    const maxLengthMinutes = Math.round((maxSongLengthMs / 1000 / 60) * 10) / 10
    if (track.duration_ms > maxSongLengthMs) {
      filteredOut.tooLong++
      logger(
        'INFO',
        `[filterTracksByCriteria] Track too long (${trackLengthMinutes}min > ${maxLengthMinutes}min): ${trackInfo}`
      )
      continue
    }

    // Check explicit content
    if (!allowExplicit && track.explicit) {
      filteredOut.explicit++
      logger(
        'INFO',
        `[filterTracksByCriteria] Track explicit (not allowed): ${trackInfo}`
      )
      continue
    }

    // Check year range if provided (secondary validation)
    if (yearRange) {
      const [startYear, endYear] = yearRange
      const releaseYear = parseInt(track.album.release_date.split('-')[0])

      if (releaseYear < startYear || releaseYear > endYear) {
        filteredOut.wrongYear++
        logger(
          'INFO',
          `[filterTracksByCriteria] Track wrong year (${releaseYear} not in ${startYear}-${endYear}): ${trackInfo}`
        )
        continue
      }
    }

    // Track passes all criteria
    candidates.push(track)
    logger(
      'INFO',
      `[filterTracksByCriteria] Track passed all criteria: ${trackInfo}`
    )
  }

  logger(
    'INFO',
    `[filterTracksByCriteria] Filter complete: ${candidates.length} candidates out of ${tracks.length} tracks. Filtered out: ${JSON.stringify(filteredOut)}`
  )

  return { candidates, filteredOut }
}

export async function searchTracksByGenre(
  genre: string,
  yearRange: [number, number],
  market: string,
  minPopularity: number,
  maxOffset: number,
  useAppToken: boolean = false
): Promise<TrackDetails[]> {
  try {
    const [startYear, endYear] = yearRange

    // Retry configuration: progressively reduce the offset cap and force last attempt to offset=0
    const maxRetries = 3
    let offsetCap = Math.max(1, Math.floor(maxOffset))

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Force the last attempt to use offset 0
      const randomOffset = attempt === maxRetries
        ? 0
        : Math.floor(Math.random() * offsetCap)

      logger(
        'INFO',
        `[searchTracksByGenre] Attempt ${attempt}/${maxRetries} for genre "${genre}" with params: ${JSON.stringify({
          yearRange: [startYear, endYear],
          market,
          minPopularity,
          offsetCap,
          offset: randomOffset,
          useAppToken
        })}`
      )

      // Construct the full request URL for logging
      const baseUrl =
        process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL || 'https://api.spotify.com/v1'
      const fullUrl = `${baseUrl}/${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)} year:${startYear}-${endYear}&type=track&limit=${TRACK_SEARCH_LIMIT}&market=${market}&offset=${randomOffset}`

      logger('INFO', `[searchTracksByGenre] Full Spotify API URL: ${fullUrl}`)

      const response = await sendApiRequest<{
        tracks: { items: TrackDetails[] }
      }>({
        path: `${SPOTIFY_SEARCH_ENDPOINT}?q=genre:${encodeURIComponent(genre)} year:${startYear}-${endYear}&type=track&limit=${TRACK_SEARCH_LIMIT}&market=${market}&offset=${randomOffset}`,
        method: 'GET',
        useAppToken,
        debounceTime: 0 // Disable caching for search requests to ensure fresh results
      })

      const tracks = response.tracks?.items
      if (!Array.isArray(tracks)) {
        logger(
          'ERROR',
          `[searchTracksByGenre] Unexpected API response format: ${JSON.stringify(response)}`
        )
        throw new Error('Unexpected API response format')
      }

      if (tracks.length > 0) {
        logger(
          'INFO',
          `[searchTracksByGenre] Retrieved ${tracks.length} tracks for genre "${genre}" on attempt ${attempt}`
        )
        // Log some sample tracks for debugging
        const sampleTracks = tracks.slice(0, 3).map((t) => ({
          name: t.name,
          artist: t.artists.map((a) => a.name).join(', '),
          popularity: t.popularity,
          duration_ms: t.duration_ms,
          is_playable: t.is_playable,
          explicit: t.explicit
        }))
        logger('INFO', `[searchTracksByGenre] Sample tracks: ${JSON.stringify(sampleTracks)}`)
        return tracks
      }

      // No results; if not last attempt, reduce offset cap and retry
      if (attempt < maxRetries) {
        const nextCap = Math.max(1, Math.floor(offsetCap / 2))
        logger(
          'WARN',
          `[searchTracksByGenre] No results (attempt=${attempt}, offsetCap=${offsetCap}, offset=${randomOffset}). Retrying with offsetCap=${nextCap}`
        )
        offsetCap = nextCap
        continue
      }

      logger('WARN', `[searchTracksByGenre] No results after ${attempt} attempt(s). Returning empty list.`)
      return []
    }

    // Fallback (should not be reached)
    return []
  } catch (error) {
    logger(
      'ERROR',
      `[searchTracksByGenre] Error searching tracks for genre "${genre}": ${error instanceof Error ? error.message : 'Unknown error'}`,
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
  },
  useAppToken: boolean = false
): Promise<TrackSearchResult> {
  logger(
    'INFO',
    `[findSuggestedTrack] Starting with params: ${JSON.stringify({
      excludedTrackIds,
      currentTrackId,
      market,
      useAppToken,
      params: params
        ? {
            genres: params.genres,
            yearRange: params.yearRange,
            popularity: params.popularity,
            allowExplicit: params.allowExplicit,
            maxSongLength: params.maxSongLength,
            songsBetweenRepeats: params.songsBetweenRepeats,
            maxOffset: params.maxOffset
          }
        : null
    })}`
  )

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

  if (params) {
    const paramsValidation = validateTrackSuggestionParams(params)
    if (!paramsValidation.isValid) {
      logger(
        'ERROR',
        `[findSuggestedTrack] Invalid parameters: ${paramsValidation.errors.join(', ')}`
      )
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
  let minPopularity = params?.popularity ?? MIN_TRACK_POPULARITY
  const allowExplicit = params?.allowExplicit ?? false
  const maxSongLength = params?.maxSongLength ?? DEFAULT_MAX_SONG_LENGTH_MINUTES
  const maxOffset = params?.maxOffset ?? DEFAULT_MAX_OFFSET

  // For specific genres with limited tracks, reduce popularity threshold after some attempts
  const isSpecificGenre =
    genres.length === 1 && genres[0] !== 'Pop' && genres[0] !== 'Rock'
  let popularityReduced = false

  logger(
    'INFO',
    `[findSuggestedTrack] Using parameters: ${JSON.stringify({
      allExcludedIds,
      genres,
      yearRange,
      minPopularity,
      allowExplicit,
      maxSongLength,
      maxOffset
    })}`
  )

  while (attempts < DEFAULT_MAX_GENRE_ATTEMPTS) {
    // Try to get an untried genre first, fallback to random if all tried
    const genre = getUntriedGenre(genres, genresTried) ?? getRandomGenre(genres)
    genresTried.push(genre)

    logger(
      'INFO',
      `[findSuggestedTrack] Attempt ${attempts + 1}/${DEFAULT_MAX_GENRE_ATTEMPTS} - Trying genre: ${genre}`
    )

    try {
      const tracks = await searchTracksByGenre(
        genre,
        yearRange,
        market,
        minPopularity,
        maxOffset,
        useAppToken
      )

      logger(
        'INFO',
        `[findSuggestedTrack] Found ${tracks.length} tracks for genre "${genre}"`
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
        allowExplicit,
        yearRange
      })

      logger(
        'INFO',
        `[findSuggestedTrack] Filter results for genre "${genre}": ${JSON.stringify(
          {
            totalTracks: tracks.length,
            candidates: filterResult.candidates.length,
            filteredOut: filterResult.filteredOut
          }
        )}`
      )

      if (selectedTrack) {
        logger(
          'INFO',
          `[findSuggestedTrack] Successfully selected track: ${selectedTrack.name} by ${selectedTrack.artists.map((a) => a.name).join(', ')}`
        )
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
        `[findSuggestedTrack] No suitable track found for genre "${genre}" - ${filterResult.candidates.length} candidates out of ${tracks.length} total tracks (highest popularity: ${highestPopularity})`
      )

      attempts++
      if (attempts < DEFAULT_MAX_GENRE_ATTEMPTS) {
        logger(
          'INFO',
          `[findSuggestedTrack] Waiting 1 second before next attempt...`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      logger(
        'ERROR',
        `[findSuggestedTrack] Error searching tracks for genre "${genre}"`,
        undefined,
        error instanceof Error ? error : new Error('Unknown error')
      )
      attempts++
      if (attempts < DEFAULT_MAX_GENRE_ATTEMPTS) {
        logger(
          'INFO',
          `[findSuggestedTrack] Waiting 1 second before next attempt...`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  logger(
    'ERROR',
    `[findSuggestedTrack] Failed to find suitable track after ${DEFAULT_MAX_GENRE_ATTEMPTS} attempts`
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
