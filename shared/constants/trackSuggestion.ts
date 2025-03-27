// Cooldown and interval settings
export const COOLDOWN_MS = 10000;
export const INTERVAL_MS = 60000; // 60 seconds
export const DEBOUNCE_MS = 10000;

// Track popularity thresholds
// 0–30: Very obscure / niche
// 30–50: Mid-tier popularity — known, but not hits
// 50–70: Popular, frequently streamed
// 70–90: Very popular — likely to be hits or viral tracks
// 90–100: Global megahits 
export const MIN_TRACK_POPULARITY = 50;

// API endpoints
export const SPOTIFY_SEARCH_ENDPOINT = "search";

// Genre options
export const FALLBACK_GENRES = [
  "Australian Alternative Rock",
  "Australian Rock",
  "Vietnamese Pop",
  "Blues-rock",
  "Contemporary Jazz",
  "Classic Rock",
  "Rock",
  "Indie Rock"
] as const;

// Configuration
export const MAX_PLAYLIST_LENGTH = 2;
export const TRACK_SEARCH_LIMIT = 50; 