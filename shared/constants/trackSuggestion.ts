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

// Default market for track search (Vietnam)
export const DEFAULT_MARKET = "VN";

// API endpoints
export const SPOTIFY_SEARCH_ENDPOINT = "search";

// Genre options
export const FALLBACK_GENRES = [
  "Australian Alternative Rock",
  "Australian Rock",
  "Australian Indie",
  "Australian Pop",
  "Australian Punk",
  "Australian Blues",
  "Australian Soul",
  "Pub Rock",
  "Vietnamese Pop",
  "Vietnamese Rock",
  "Vietnamese Indie",
  "Grunge",
  "Grunge Pop",
  "Alternative Rock",
  "Alternative Pop",
  "Vietnamese R&B",
  "Nerdcore",
  "Blues-rock",
  "Contemporary Jazz",
  "Classic Rock",
  "Rock",
  "Indie Rock",
  "Soul",
  "Alternative Pop",
  "Funk",
] as const;

// Configuration
export const MAX_PLAYLIST_LENGTH = 2;
export const TRACK_SEARCH_LIMIT = 50;
