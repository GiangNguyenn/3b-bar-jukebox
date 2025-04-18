import { TrackDetails } from '@/shared/types'
import { sendApiRequest } from '@/shared/api'
import {
  FALLBACK_GENRES,
  MIN_TRACK_POPULARITY,
  SPOTIFY_SEARCH_ENDPOINT,
  TRACK_SEARCH_LIMIT,
  DEFAULT_MARKET
} from '@/shared/constants/trackSuggestion'

export type Genre = string

const GENRES = [
  'rock',
  'pop',
  'jazz',
  'classical',
  'electronic',
  'hip-hop',
  'r&b',
  'country',
  'blues',
  'folk',
  'metal',
  'punk',
  'reggae',
  'soul',
  'funk',
  'indie',
  'alternative',
  'ambient',
  'dance',
  'house'
] as const

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

    if (!isPlayable) {
      console.log(`[TrackSuggestion] Track ${track.name} is not playable`)
    }
    if (isExcluded) {
      console.log(`[TrackSuggestion] Track ${track.name} is excluded`)
    }
    if (!meetsPopularity) {
      console.log(
        `[TrackSuggestion] Track ${track.name} popularity ${track.popularity} < ${minPopularity}`
      )
    }
    if (!meetsLength) {
      console.log(
        `[TrackSuggestion] Track ${track.name} duration ${Math.floor(track.duration_ms / 1000 / 60)}m ${Math.floor((track.duration_ms / 1000) % 60)}s > ${maxSongLength} minutes`
      )
    }
    if (!meetsExplicit) {
      console.log(
        `[TrackSuggestion] Track ${track.name} is explicit but not allowed`
      )
    }

    return (
      !isExcluded &&
      meetsPopularity &&
      isPlayable &&
      meetsLength &&
      meetsExplicit
    )
  })

  if (candidates.length === 0) {
    console.log('[TrackSuggestion] No candidates found after filtering')
    return null
  }

  const randomIndex = Math.floor(Math.random() * candidates.length)
  const selectedTrack = candidates[randomIndex]
  console.log(
    `[TrackSuggestion] Selected track: ${selectedTrack.name} (${selectedTrack.artists[0].name})`
  )

  return selectedTrack
}

export async function searchTracksByGenre(
  genre: string,
  yearRange: [number, number],
  market: string = DEFAULT_MARKET
): Promise<TrackDetails[]> {
  try {
    const [startYear, endYear] = yearRange
    console.log(
      `[TrackSuggestion] Searching tracks for genre ${genre} (${startYear}-${endYear})`
    )

    // Add random offset between 0 and 900 (Spotify's max offset is 1000)
    const randomOffset = Math.floor(Math.random() * 900)
    console.log(`[TrackSuggestion] Using random offset: ${randomOffset}`)

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

    console.log(
      `[TrackSuggestion] Found ${tracks.length} tracks for genre ${genre} starting at offset ${randomOffset}`
    )
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
  const genre = genres[Math.floor(Math.random() * genres.length)]
  console.log(`[TrackSuggestion] Selected random genre: ${genre}`)
  return genre
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
  }
): Promise<TrackSearchResult> {
  console.log(
    '[PARAM CHAIN] Genres received in findSuggestedTrack (trackSuggestion.ts):',
    params?.genres
  )
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
  console.log(
    '[PARAM CHAIN] FALLBACK_GENRES value:',
    Array.from(FALLBACK_GENRES)
  )
  console.log('[PARAM CHAIN] Using fallback genres:', !params?.genres?.length)
  console.log(
    '[PARAM CHAIN] Final genres being used in findSuggestedTrack (trackSuggestion.ts):',
    genres
  )
  const yearRange = params?.yearRange ?? [1950, new Date().getFullYear()]
  const minPopularity = params?.popularity ?? MIN_TRACK_POPULARITY
  const allowExplicit = params?.allowExplicit ?? false
  const maxSongLength = params?.maxSongLength ?? 3 // Default to 3 minutes

  console.log('[TrackSuggestion] Starting track search with params:', {
    genres,
    yearRange,
    minPopularity,
    allowExplicit,
    maxSongLength,
    excludedIds: allExcludedIds.length
  })

  while (attempts < MAX_GENRE_ATTEMPTS) {
    const genre = getRandomGenre(genres)
    genresTried.push(genre)

    try {
      const tracks = await searchTracksByGenre(genre, yearRange, market)

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

      const selectedTrack = selectRandomTrack(
        tracks,
        allExcludedIds,
        minPopularity,
        maxSongLength,
        allowExplicit
      )

      if (selectedTrack) {
        console.log('[TrackSuggestion] Successfully found track:', {
          name: selectedTrack.name,
          artist: selectedTrack.artists[0].name,
          genre,
          attempts: attempts + 1
        })
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
      console.log(
        `[TrackSuggestion] Attempt ${attempts} failed to find suitable track`
      )

      if (attempts < MAX_GENRE_ATTEMPTS) {
        // Add a small delay between attempts
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(
        `[TrackSuggestion] Error during track search attempt ${attempts + 1}:`,
        error
      )
      attempts++
      if (attempts >= MAX_GENRE_ATTEMPTS) {
        throw error
      }
    }
  }

  console.log('[TrackSuggestion] Failed to find track after all attempts')
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
