export interface AiSuggestionsState {
  selectedPresetId: string | null
  customPrompt: string
  autoFillTargetSize: number
}

export interface AiSongRecommendation {
  title: string
  artist: string
}

export interface AiSuggestionResult {
  tracks: Array<{ spotifyTrackId: string; title: string; artist: string }>
  failedResolutions: Array<{ title: string; artist: string; reason: string }>
}

export interface RecentlyPlayedEntry {
  spotifyTrackId: string
  title: string
  artist: string
}
