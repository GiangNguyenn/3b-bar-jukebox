import type { SpotifyPlaybackState, TrackDetails } from '@/shared/types/spotify'
import type { GameOptionTrack, TargetArtist } from '../gameService'

export type PlayerId = 'player1' | 'player2'

export interface PlayerTargetsMap {
  player1: TargetArtist | null
  player2: TargetArtist | null
}

export interface PlayerGravityMap {
  player1: number
  player2: number
}

export interface GamePlayer {
  id: PlayerId
  score: number
  targetArtist: TargetArtist | null
}

export interface DgsSelectionMeta {
  trackId: string
  playerId: PlayerId
  previousTrackId?: string | null
  selectionCategory?: 'closer' | 'neutral' | 'further' // Quality of choice relative to target
}

export interface DualGravityRequest {
  playbackState: SpotifyPlaybackState
  roundNumber: number
  turnNumber: number
  currentPlayerId: PlayerId
  playerTargets: PlayerTargetsMap
  playerGravities: PlayerGravityMap
  playedTrackIds: string[]
  lastSelection?: DgsSelectionMeta | null
}

import {
  MAX_ROUND_TURNS,
  DISPLAY_OPTION_COUNT,
  MIN_CANDIDATE_POOL,
  MAX_CANDIDATE_POOL,
  MIN_UNIQUE_ARTISTS,
  GRAVITY_LIMITS,
  UNDERDOG_CONFIG,
  VICINITY_DISTANCE_THRESHOLD,
  OG_CONSTANT,
  CATEGORY_WEIGHTS,
  GUARANTEED_MINIMUMS,
  MIN_QUALITY_THRESHOLDS,
  DIVERSITY_SOURCES
} from './gameRules'

export {
  MAX_ROUND_TURNS,
  DISPLAY_OPTION_COUNT,
  MIN_CANDIDATE_POOL,
  MAX_CANDIDATE_POOL,
  MIN_UNIQUE_ARTISTS,
  GRAVITY_LIMITS,
  UNDERDOG_CONFIG,
  VICINITY_DISTANCE_THRESHOLD,
  OG_CONSTANT,
  CATEGORY_WEIGHTS,
  GUARANTEED_MINIMUMS,
  MIN_QUALITY_THRESHOLDS,
  DIVERSITY_SOURCES
}

export interface ExplorationPhase {
  level: 'high' | 'medium' | 'low'
  ogDrift: number
  rounds: [number, number]
}

export type CandidateSource =
  | 'related_top_tracks'
  | 'recommendations'
  | 'embedding'
  | 'target_insertion'
  | 'target_boost'
  | 'related_artist_insertion'

export type PopularityBand = 'low' | 'mid' | 'high'

export interface GenreMatchDetail {
  candidateGenre: string
  bestMatchGenre: string
  score: number
  matchType: 'exact' | 'partial' | 'cluster' | 'related' | 'unrelated'
  clusterA?: string // Candidate cluster
  clusterB?: string // Base cluster
}

export interface GenreScoreComponent {
  score: number
  details: GenreMatchDetail[]
  candidateGenres?: string[]
  targetGenres?: string[]
}

export interface ScoringComponents {
  genre: GenreScoreComponent
  relationship: number
  trackPop: number
  artistPop: number
  era: number
  followers: number
}

export interface CandidateTrackMetrics {
  track: TrackDetails
  source: CandidateSource
  artistId?: string
  artistName?: string
  artistGenres?: string[]
  simScore: number
  scoreComponents?: ScoringComponents // Breakdown of the simScore
  aAttraction: number
  bAttraction: number
  gravityScore: number
  stabilizedScore: number
  finalScore: number
  popularityBand: PopularityBand
  vicinityDistances: Partial<Record<PlayerId, number>>
  forceReason?: 'vicinity' | 'hard_convergence'
  currentSongAttraction: number // Baseline attraction of currently playing song to active player's target
  selectionCategory?: 'closer' | 'neutral' | 'further' // Category assigned during selection
}

export interface DgsOptionTrack extends GameOptionTrack {
  metrics: Omit<CandidateTrackMetrics, 'track'>
}

export interface DgsCachingMetrics {
  // Top Tracks
  topTracksRequested: number
  topTracksCached: number
  topTracksFromSpotify: number // Items
  topTracksApiCalls: number // Network

  // Track Details
  trackDetailsRequested: number
  trackDetailsCached: number
  trackDetailsFromSpotify: number // Items
  trackDetailsApiCalls: number // Network

  // Related Artists
  relatedArtistsRequested: number
  relatedArtistsCached: number
  relatedArtistsFromSpotify: number // Items
  relatedArtistsApiCalls: number // Network

  // Artist Profiles
  artistProfilesRequested: number
  artistProfilesCached: number
  artistProfilesFromSpotify: number // Items
  artistProfilesApiCalls: number // Network

  // Artist Searches
  artistSearchesRequested: number
  artistSearchesCached: number
  artistSearchesFromSpotify: number // Items
  artistSearchesApiCalls: number // Network

  // Internal tracking
  _cachedArtistIds?: Set<string>
  _requestedArtistIds?: Set<string>
}

export interface CategoryQuality {
  averageAttractionDelta: number
  diversityScore: number
  popularitySpread: number
  genreVariety: number
  qualityScore: number
}

export interface DgsDebugInfo {
  targetProfiles: {
    player1: {
      resolved: boolean
      artistName: string | null
      spotifyId: string | null
      genresCount: number
    }
    player2: {
      resolved: boolean
      artistName: string | null
      spotifyId: string | null
      genresCount: number
    }
  }
  artistProfiles: {
    requested: number
    fetched: number
    missing: number
    successRate: number
  }
  scoring: {
    totalCandidates: number
    fallbackFetches: number
    p1NonZeroAttraction: number
    p2NonZeroAttraction: number
    zeroAttractionReasons: {
      missingArtistProfile: number
      nullTargetProfile: number
      zeroSimilarity: number
    }
  }
  candidates: Array<{
    artistName: string
    trackName?: string
    source?: string
    simScore: number
    isTargetArtist: boolean
    filtered: boolean
  }>
  dbFallback?: {
    used: boolean
    addedTracks: number
    addedArtists: number
    reason?: 'genre_deficiency' | 'artist_deficiency' | 'absolute_fallback'
    requestedTracks?: number
  }
  executionTimeMs?: number
  timingBreakdown?: {
    candidatePoolMs: number
    targetResolutionMs: number
    enrichmentMs: number
    scoringMs: number
    selectionMs: number
    totalMs: number
  }
  performanceDiagnostics?: {
    dbQueries: Array<{ operation: string; durationMs: number }>
    apiCalls: Array<{ operation: string; durationMs: number }>
    totalDbTimeMs: number
    totalApiTimeMs: number
    slowestDbQuery: { operation: string; durationMs: number } | null
    slowestApiCall: { operation: string; durationMs: number } | null
    bottleneckPhase: string
  }
  caching: {
    // Top Tracks
    topTracksRequested: number
    topTracksCached: number
    topTracksFromSpotify: number // Items
    topTracksApiCalls: number // Network calls

    // Track Details
    trackDetailsRequested: number
    trackDetailsCached: number
    trackDetailsFromSpotify: number // Items
    trackDetailsApiCalls: number // Network calls

    // Related Artists
    relatedArtistsRequested: number
    relatedArtistsCached: number
    relatedArtistsFromSpotify: number // Items
    relatedArtistsApiCalls: number // Network calls

    // Artist Profiles
    artistProfilesRequested: number
    artistProfilesCached: number
    artistProfilesFromSpotify: number // Items
    artistProfilesApiCalls: number // Network calls

    // Artist Searches
    artistSearchesRequested: number
    artistSearchesCached: number
    artistSearchesFromSpotify: number // Items
    artistSearchesApiCalls: number // Network calls

    // Overall metrics
    cacheHitRate: number
    totalApiCalls: number
    totalCacheHits: number
  }
  genreStatistics?: {
    totalTracks: number
    tracksWithNullGenres: number
    tracksWithGenres: number
    percentageCoverage: number
  }
  backfillMetrics?: {
    trackAttempts: number
    trackSuccesses: number
    trackFailures: number
    artistAttempts: number
    artistSuccesses: number
    artistFailures: number
  }
  candidatePool?: {
    totalUnique: number
    seedArtists?: Array<{ name: string; id: string }>
    targetArtists?: Array<{ name: string; id: string }>
  }
}

export interface DualGravityResponse {
  targetArtists: TargetArtist[]
  optionTracks: DgsOptionTrack[]
  updatedGravities: PlayerGravityMap
  explorationPhase: ExplorationPhase
  ogDrift: number
  candidatePoolSize: number
  hardConvergenceActive: boolean
  vicinity: {
    triggered: boolean
    playerId?: PlayerId
  }
  debugInfo?: DgsDebugInfo
}

export const DEFAULT_PLAYER_GRAVITY = 0.32
export const MAX_ARTIST_REPETITIONS = 2

export interface CandidateSeed {
  track: TrackDetails
  source: CandidateSource
}

export interface ArtistProfile {
  id: string
  name: string
  genres: string[]
  popularity?: number
  followers?: number
}

export interface TargetProfile {
  artist: TargetArtist
  spotifyId?: string
  genres: string[]
  popularity?: number
  followers?: number
}
