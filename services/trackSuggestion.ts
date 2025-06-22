import { TrackDetails } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import {
  FALLBACK_GENRES,
  MIN_TRACK_POPULARITY,
  SPOTIFY_SEARCH_ENDPOINT,
  TRACK_SEARCH_LIMIT,
  DEFAULT_MARKET
} from '@/shared/constants/trackSuggestion'

export type Genre = string

// Utility: Select a random track from a filtered list
export function selectRandomTrack(
  tracks: TrackDetails[],
  excludedIds: string[],
  minPopularity: number,
  maxSongLength: number, // maxSongLength is in minutes
  allowExplicit: boolean
): TrackDetails | null {
  const candidates = tracks.filter((track) => {
    const isExcluded = excludedIds.includes(track.id)
    const meetsPopularity = track.popularity >= minPopularity
    const isPlayable = track.is_playable === true
    const maxDurationMs = maxSongLength * 60 * 1000 // Convert minutes to milliseconds
    const meetsLength = track.duration_ms <= maxDurationMs
    const meetsExplicit = allowExplicit || !track.explicit

    return (
      !isExcluded &&
      meetsPopularity &&
      isPlayable &&
      meetsLength &&
      meetsExplicit
    )
  })

  if (candidates.length === 0) {
    return null
  }

  const randomIndex = Math.floor(Math.random() * candidates.length)
  return candidates[randomIndex]
}

export async function searchTracksByGenre(
  genre: string,
  yearRange: [number, number],
  market: string = DEFAULT_MARKET,
  minPopularity: number = MIN_TRACK_POPULARITY,
  maxOffset: number = 1000
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
    console.error(
      `[TrackSuggestion] Error searching tracks for genre ${genre}:`,
      error
    )
    throw error
  }
}

export function getRandomGenre(genres: Genre[]): Genre {
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
  const MAX_GENRE_ATTEMPTS = 20
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
  const genres = params?.genres?.length
    ? params.genres
    : Array.from(FALLBACK_GENRES)

  const yearRange = params?.yearRange ?? [1950, new Date().getFullYear()]
  const minPopularity = params?.popularity ?? MIN_TRACK_POPULARITY
  const allowExplicit = params?.allowExplicit ?? false
  const maxSongLength = params?.maxSongLength ?? 3 // Default to 3 minutes
  const maxOffset = params?.maxOffset ?? 1000 // Default to 1000

  console.log('[TrackSuggestion] Starting track search with params:', {
    excludedTrackIds: allExcludedIds.length,
    currentTrackId,
    genres: genres.length,
    yearRange,
    minPopularity,
    allowExplicit,
    maxSongLength,
    maxOffset,
    timestamp: new Date().toISOString()
  })

  while (attempts < MAX_GENRE_ATTEMPTS) {
    const genre = getRandomGenre(genres)
    genresTried.push(genre)

    console.log(
      `[TrackSuggestion] Attempt ${attempts + 1}/${MAX_GENRE_ATTEMPTS}: Searching genre "${genre}"`,
      {
        attempt: attempts + 1,
        maxAttempts: MAX_GENRE_ATTEMPTS,
        genre,
        genresTried,
        timestamp: new Date().toISOString()
      }
    )

    try {
      const searchStartTime = Date.now()
      const tracks = await searchTracksByGenre(
        genre,
        yearRange,
        market,
        minPopularity,
        maxOffset
      )
      const searchDuration = Date.now() - searchStartTime

      console.log(
        `[TrackSuggestion] Found ${tracks.length} tracks for genre "${genre}" in ${searchDuration}ms`,
        {
          attempt: attempts + 1,
          genre,
          tracksFound: tracks.length,
          searchDuration,
          timestamp: new Date().toISOString()
        }
      )

      // Log details about the tracks we found
      const trackDetails = tracks.map((t) => ({
        name: t.name,
        popularity: t.popularity,
        isExcluded: allExcludedIds.includes(t.id),
        isPlayable: t.is_playable,
        duration_ms: t.duration_ms,
        explicit: t.explicit
      }))
      allTrackDetails.push(...trackDetails)

      const selectionStartTime = Date.now()
      const selectedTrack = selectRandomTrack(
        tracks,
        allExcludedIds,
        minPopularity,
        maxSongLength,
        allowExplicit
      )
      const selectionDuration = Date.now() - selectionStartTime

      // Count how many tracks meet each criteria
      const playableCount = tracks.filter((t) => t.is_playable === true).length
      const popularityCount = tracks.filter(
        (t) => t.popularity >= minPopularity
      ).length
      const lengthCount = tracks.filter(
        (t) => t.duration_ms <= maxSongLength * 60 * 1000
      ).length
      const explicitCount = tracks.filter(
        (t) => allowExplicit || !t.explicit
      ).length
      const excludedCount = tracks.filter((t) =>
        allExcludedIds.includes(t.id)
      ).length

      console.log(`[TrackSuggestion] Track selection results for "${genre}":`, {
        attempt: attempts + 1,
        genre,
        totalTracks: tracks.length,
        playableCount,
        popularityCount,
        lengthCount,
        explicitCount,
        excludedCount,
        selectedTrack: selectedTrack
          ? {
              name: selectedTrack.name,
              artist: selectedTrack.artists[0]?.name,
              popularity: selectedTrack.popularity,
              duration:
                Math.round((selectedTrack.duration_ms / 1000 / 60) * 10) / 10 +
                'min'
            }
          : null,
        selectionDuration,
        timestamp: new Date().toISOString()
      })

      if (selectedTrack) {
        console.log(
          `[TrackSuggestion] Successfully found track after ${attempts + 1} attempts:`,
          {
            trackName: selectedTrack.name,
            artist: selectedTrack.artists[0]?.name,
            album: selectedTrack.album?.name,
            popularity: selectedTrack.popularity,
            duration:
              Math.round((selectedTrack.duration_ms / 1000 / 60) * 10) / 10 +
              'min',
            genresTried,
            totalTracksSearched: allTrackDetails.length,
            timestamp: new Date().toISOString()
          }
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

      attempts++
      if (attempts < MAX_GENRE_ATTEMPTS) {
        console.log(
          `[TrackSuggestion] No suitable track found for "${genre}", waiting 1s before next attempt`,
          {
            attempt: attempts,
            nextAttempt: attempts + 1,
            timestamp: new Date().toISOString()
          }
        )
        // Add a small delay between attempts
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(
        `[TrackSuggestion] Error during track search attempt ${attempts + 1} for genre "${genre}":`,
        {
          attempt: attempts + 1,
          genre,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        }
      )
      attempts++
      if (attempts >= MAX_GENRE_ATTEMPTS) {
        throw error
      }
    }
  }

  console.log(
    `[TrackSuggestion] Failed to find suitable track after ${MAX_GENRE_ATTEMPTS} attempts`,
    {
      totalAttempts: attempts,
      genresTried,
      totalTracksSearched: allTrackDetails.length,
      excludedTrackIds: allExcludedIds.length,
      timestamp: new Date().toISOString()
    }
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
