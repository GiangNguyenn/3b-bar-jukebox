import { Genre } from '@/shared/constants/trackSuggestion'
import {
  MIN_POPULARITY,
  MAX_POPULARITY,
  MIN_SONG_LENGTH_MINUTES,
  MAX_SONG_LENGTH_MINUTES,
  MIN_YEAR,
  MAX_YEAR
} from '@/shared/constants/trackSuggestion'

export interface TrackSuggestionParams {
  genres: Genre[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  maxOffset: number
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export function validateTrackSuggestionParams(
  params: Partial<TrackSuggestionParams>
): ValidationResult {
  const errors: string[] = []

  // Validate genres
  if (params.genres !== undefined) {
    if (!Array.isArray(params.genres)) {
      errors.push('Genres must be an array')
    } else if (params.genres.length === 0) {
      errors.push('Genres array cannot be empty')
    } else {
      const invalidGenres = params.genres.filter(
        (genre) => typeof genre !== 'string' || genre.trim() === ''
      )
      if (invalidGenres.length > 0) {
        errors.push('All genres must be non-empty strings')
      }
    }
  }

  // Validate year range
  if (params.yearRange !== undefined) {
    if (!Array.isArray(params.yearRange) || params.yearRange.length !== 2) {
      errors.push('Year range must be an array with exactly 2 elements')
    } else {
      const [startYear, endYear] = params.yearRange
      if (typeof startYear !== 'number' || typeof endYear !== 'number') {
        errors.push('Year range elements must be numbers')
      } else {
        if (startYear < MIN_YEAR || startYear > MAX_YEAR) {
          errors.push(`Start year must be between ${MIN_YEAR} and ${MAX_YEAR}`)
        }
        if (endYear < MIN_YEAR || endYear > MAX_YEAR) {
          errors.push(`End year must be between ${MIN_YEAR} and ${MAX_YEAR}`)
        }
        if (startYear > endYear) {
          errors.push('Start year cannot be greater than end year')
        }
      }
    }
  }

  // Validate popularity
  if (params.popularity !== undefined) {
    if (typeof params.popularity !== 'number') {
      errors.push('Popularity must be a number')
    } else if (
      params.popularity < MIN_POPULARITY ||
      params.popularity > MAX_POPULARITY
    ) {
      errors.push(
        `Popularity must be between ${MIN_POPULARITY} and ${MAX_POPULARITY}`
      )
    }
  }

  // Validate allowExplicit
  if (
    params.allowExplicit !== undefined &&
    typeof params.allowExplicit !== 'boolean'
  ) {
    errors.push('Allow explicit must be a boolean')
  }

  // Validate maxSongLength
  if (params.maxSongLength !== undefined) {
    if (typeof params.maxSongLength !== 'number') {
      errors.push('Max song length must be a number')
    } else if (
      params.maxSongLength < MIN_SONG_LENGTH_MINUTES ||
      params.maxSongLength > MAX_SONG_LENGTH_MINUTES
    ) {
      errors.push(
        `Max song length must be between ${MIN_SONG_LENGTH_MINUTES} and ${MAX_SONG_LENGTH_MINUTES} minutes`
      )
    }
  }

  // Validate maxOffset
  if (params.maxOffset !== undefined) {
    if (typeof params.maxOffset !== 'number') {
      errors.push('Max offset must be a number')
    } else if (params.maxOffset < 1) {
      errors.push('Max offset must be at least 1')
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

export function validateExcludedTrackIds(
  excludedTrackIds: string[]
): ValidationResult {
  const errors: string[] = []

  if (!Array.isArray(excludedTrackIds)) {
    errors.push('Excluded track IDs must be an array')
  } else {
    const invalidIds = excludedTrackIds.filter(
      (id) => typeof id !== 'string' || id.trim() === ''
    )
    if (invalidIds.length > 0) {
      errors.push('All excluded track IDs must be non-empty strings')
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}
