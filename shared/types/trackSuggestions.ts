import { Genre } from '@/shared/constants/trackSuggestion'

export interface LastSuggestedTrackInfo {
  name: string
  artist: string
  album: string
  uri: string
  genres: string[]
  popularity: number
  duration_ms: number
  preview_url?: string
}

export interface TrackSuggestionsState {
  genres: Genre[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
  maxOffset: number
  lastSuggestedTrack?: LastSuggestedTrackInfo
}
