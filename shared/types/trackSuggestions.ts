// Type definitions for track suggestions state
export interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  maxOffset: number
  autoFillTargetSize: number
}

// Type definition for the last suggested track information
export interface LastSuggestedTrackInfo {
  name: string
  artist: string
  album: string
  uri: string
  popularity: number
  duration_ms: number
  preview_url: string | null
  genres: string[]
}

// Type guard for validating track suggestions state
export function isValidTrackSuggestionsState(
  state: unknown
): state is TrackSuggestionsState {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  return (
    Array.isArray(s.genres) &&
    s.genres.every((g) => typeof g === 'string') &&
    Array.isArray(s.yearRange) &&
    s.yearRange.length === 2 &&
    typeof s.yearRange[0] === 'number' &&
    typeof s.yearRange[1] === 'number' &&
    typeof s.popularity === 'number' &&
    typeof s.allowExplicit === 'boolean' &&
    typeof s.maxSongLength === 'number' &&
    typeof s.maxOffset === 'number' &&
    typeof s.autoFillTargetSize === 'number'
  )
}
