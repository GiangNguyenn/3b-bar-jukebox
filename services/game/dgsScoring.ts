import type {
  ArtistProfile,
  TargetProfile,
  ScoringComponents,
  PopularityBand,
  PlayerId,
  PlayerGravityMap,
  CandidateTrackMetrics,
  CandidateSource
} from './dgsTypes'
import type { TrackDetails } from '@/shared/types/spotify'
import { GRAVITY_LIMITS, DEFAULT_PLAYER_GRAVITY } from './dgsTypes'
import { calculateAvgMaxGenreSimilarity } from './genreGraph'

export interface TrackMetadata {
  popularity: number
  duration_ms: number
  release_date?: string
  genres: string[]
  artistId?: string
}

export const DUMMY_COMPONENTS: ScoringComponents = {
  genre: { score: 0, details: [] },
  relationship: 0,
  trackPop: 0,
  artistPop: 0,
  era: 0,
  followers: 0
}

export function clampGravity(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_PLAYER_GRAVITY
  }
  if (value < GRAVITY_LIMITS.min) {
    return GRAVITY_LIMITS.min
  }
  if (value > GRAVITY_LIMITS.max) {
    return GRAVITY_LIMITS.max
  }
  return value
}

export function isValidSpotifyId(id: string | undefined): boolean {
  if (!id) return false
  // Spotify IDs are 22-char base62 strings (letters + digits, no dashes)
  return id.length === 22 && /^[0-9A-Za-z]+$/.test(id)
}

export function getPopularityBand(popularity: number): PopularityBand {
  if (popularity < 34) return 'low'
  if (popularity < 67) return 'mid'
  return 'high'
}

export function extractTrackMetadata(
  track: TrackDetails,
  artistProfile: ArtistProfile | undefined
): TrackMetadata {
  return {
    popularity: track.popularity ?? 50,
    duration_ms: track.duration_ms ?? 180000,
    release_date: track.album?.release_date,
    genres: artistProfile?.genres ?? [],
    artistId: track.artists?.[0]?.id
  }
}

/**
 * Calculate similarity based on follower counts using logarithmic scale
 * Returns 0.0 to 1.0, where 1.0 = similar fanbase size
 */
export function computeFollowerSimilarity(
  followers1: number | undefined,
  followers2: number | undefined
): number {
  if (!followers1 || !followers2) {
    return 0.5 // Neutral when data missing
  }

  // Use log10 to handle wide range of follower counts (1K to 100M+)
  const log1 = Math.log10(Math.max(followers1, 1))
  const log2 = Math.log10(Math.max(followers2, 1))
  const logDiff = Math.abs(log1 - log2)

  // logDiff of 3 = 1000x difference (e.g., 1K vs 1M)
  // Normalize to 0-1 range
  return 1 - Math.min(logDiff / 3, 1)
}

/**
 * Calculate similarity based on popularity scores (0-100)
 * Returns 0.0 to 1.0, where 1.0 = identical popularity
 */
export function computePopularitySimilarity(
  popularity1: number | undefined,
  popularity2: number | undefined
): number {
  if (popularity1 === undefined || popularity2 === undefined) {
    return 0.5 // Neutral when data missing
  }
  const difference = Math.abs(popularity1 - popularity2)
  return 1 - difference / 100
}

function computeReleaseEraSimilarity(
  releaseDate1?: string,
  releaseDate2?: string
): number {
  if (!releaseDate1 || !releaseDate2) {
    return 0.5 // Neutral if missing
  }

  try {
    // Parse dates (format: YYYY-MM-DD or YYYY-MM or YYYY)
    const year1 = parseInt(releaseDate1.substring(0, 4), 10)
    const year2 = parseInt(releaseDate2.substring(0, 4), 10)

    if (isNaN(year1) || isNaN(year2)) {
      return 0.5
    }

    const yearDiff = Math.abs(year1 - year2)
    // Similar if within 5 years, decreasing after that
    const maxDiff = 30 // 30 years max difference
    return Math.max(0, 1 - yearDiff / maxDiff)
  } catch {
    return 0.5
  }
}

function computeArtistRelationshipScore(
  baseArtistId: string | undefined,
  candidateArtistId: string | undefined,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): number {
  // If same artist, return 1.0
  if (baseArtistId && candidateArtistId && baseArtistId === candidateArtistId) {
    return 1.0
  }

  // If either artist is missing, return 0.5 (neutral)
  if (!baseArtistId || !candidateArtistId) {
    return 0.5
  }

  // O(1) lookup in pre-fetched relationships map
  const baseRelations = artistRelationships.get(baseArtistId)
  if (baseRelations && baseRelations.has(candidateArtistId)) {
    return 1.0
  }

  // Fallback: Check genre overlap as proxy for relationship
  const baseProfile = artistProfiles.get(baseArtistId)
  const candidateProfile = artistProfiles.get(candidateArtistId)

  if (!baseProfile || !candidateProfile) {
    return 0.5
  }

  // High genre overlap suggests related artists
  // Use weighted genre graph
  const genreOverlap = calculateAvgMaxGenreSimilarity(
    baseProfile.genres,
    candidateProfile.genres
  )
  return genreOverlap.score * 0.7 + 0.3 // Scale to 0.3-1.0 range
}

/**
 * Compute similarity strictly between two artists
 * Ignores track-level metadata like release date or track popularity
 * Used for "Attraction" calculation (Target-to-Candidate proximity)
 */
export function computeStrictArtistSimilarity(
  baseProfile: ArtistProfile,
  candidateProfile: ArtistProfile,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): { score: number; components: ScoringComponents } {
  // 1. Identity Check (Mathematical Truth, not a hack)
  if (baseProfile.id === candidateProfile.id) {
    return {
      score: 1.0,
      components: {
        genre: { score: 1.0, details: [] },
        relationship: 1.0,
        trackPop: 1.0,
        artistPop: 1.0,
        era: 1.0,
        followers: 1.0
      }
    }
  }

  // 2. Genre Similarity (40%)
  const genreSimilarity = calculateAvgMaxGenreSimilarity(
    baseProfile.genres,
    candidateProfile.genres
  )

  // 3. Relationship (30%)
  const relationshipScore = computeArtistRelationshipScore(
    baseProfile.id,
    candidateProfile.id,
    artistProfiles,
    artistRelationships
  )

  // 4. Artist Popularity (15%)
  const artistPopSim = computePopularitySimilarity(
    baseProfile.popularity,
    candidateProfile.popularity
  )

  // 5. Follower Similarity (15%)
  const followerSim = computeFollowerSimilarity(
    baseProfile.followers,
    candidateProfile.followers
  )

  // Weighted Score
  // Requirements: docs/requirements_scoring_logic.md Section 2.2
  // Genre (40%) + Relationship (30%) + Artist Pop (15%) + Followers (15%)
  const score =
    genreSimilarity.score * 0.4 +
    relationshipScore * 0.3 +
    artistPopSim * 0.15 +
    followerSim * 0.15

  // Validation: Verify score calculation matches requirements
  const calculatedScore = score
  const expectedScore = 
    genreSimilarity.score * 0.4 +
    relationshipScore * 0.3 +
    artistPopSim * 0.15 +
    followerSim * 0.15
  
  if (Math.abs(calculatedScore - expectedScore) > 0.0001) {
    // This should never happen, but log if it does
    console.warn(
      `Score calculation mismatch: calculated=${calculatedScore}, expected=${expectedScore}`
    )
  }

  return {
    score,
    components: {
      genre: {
        ...genreSimilarity,
        candidateGenres: candidateProfile.genres,
        targetGenres: baseProfile.genres
      },
      relationship: relationshipScore,
      trackPop: 0, // Not used in attraction calculation per requirements
      artistPop: artistPopSim,
      era: 0, // Not used in attraction calculation per requirements
      followers: followerSim
    }
  }
}

export function computeAttraction(
  artistProfile: ArtistProfile | undefined,
  targetProfile: TargetProfile | null,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): { score: number; components: ScoringComponents } {
  if (!artistProfile) {
    return { score: 0, components: DUMMY_COMPONENTS }
  }
  if (!targetProfile) {
    return { score: 0, components: DUMMY_COMPONENTS }
  }

  // Create minimal ArtistProfile for target
  const targetArtistProfile: ArtistProfile = {
    id:
      targetProfile.spotifyId && targetProfile.spotifyId.length > 0
        ? targetProfile.spotifyId
        : (targetProfile.artist.id ?? 'unknown'),
    name: targetProfile.artist.name,
    genres: targetProfile.genres,
    popularity: targetProfile.popularity ?? 0,
    followers: targetProfile.followers
  }

  // Calculate strict artist-to-artist similarity
  const { score, components } = computeStrictArtistSimilarity(
    targetArtistProfile,
    artistProfile,
    artistProfiles,
    artistRelationships
  )

  return { score: score ?? 0, components }
}

export function computeSimilarity(
  baseTrack: TrackDetails,
  baseMetadata: TrackMetadata,
  candidateTrack: TrackDetails,
  candidateMetadata: TrackMetadata,
  artistProfiles: Map<string, ArtistProfile>,
  artistRelationships: Map<string, Set<string>>
): { score: number; components: ScoringComponents } {
  // Genre similarity (25% weight)
  // Use weighted genre graph instead of simple Jaccard index
  const genreSimilarity = calculateAvgMaxGenreSimilarity(
    baseMetadata.genres,
    candidateMetadata.genres
  )

  // Track popularity proximity (15% weight) - reduced from 20%
  const popularityDiff = Math.abs(
    baseMetadata.popularity - candidateMetadata.popularity
  )
  const trackPopularitySimilarity = Math.max(0, 1 - popularityDiff / 100)

  // Artist Popularity proximity (10% weight)
  const artistPopSim = computeArtistPopularitySimilarity(
    baseMetadata.artistId,
    candidateMetadata.artistId,
    artistProfiles
  )

  // Release Era (15% weight)
  // Similar if close in release year (e.g., both from 90s)
  const releaseSimilarity = computeReleaseEraSimilarity(
    baseMetadata.release_date,
    candidateMetadata.release_date
  )

  // Relationship (20% weight) - reduced from 25%
  // Are artists related on Spotify? Or share high genre overlap?
  const artistRelationshipScore = computeArtistRelationshipScore(
    baseMetadata.artistId,
    candidateMetadata.artistId,
    artistProfiles,
    artistRelationships
  )

  // Follower count similarity (15% weight)
  // Similar if both are huge stars or both are indie
  const baseProfile = baseMetadata.artistId
    ? artistProfiles.get(baseMetadata.artistId)
    : undefined
  const candidateProfile = candidateMetadata.artistId
    ? artistProfiles.get(candidateMetadata.artistId)
    : undefined
  const followerSimilarity = computeFollowerSimilarity(
    baseProfile?.followers,
    candidateProfile?.followers
  )

  // Weighted sum
  const finalScore =
    genreSimilarity.score * 0.25 +
    trackPopularitySimilarity * 0.15 +
    artistPopSim * 0.1 +
    releaseSimilarity * 0.15 +
    artistRelationshipScore * 0.2 +
    followerSimilarity * 0.15

  return {
    score: finalScore,
    components: {
      genre: {
        ...genreSimilarity,
        candidateGenres: candidateMetadata.genres,
        targetGenres: baseMetadata.genres
      },
      relationship: artistRelationshipScore,
      trackPop: trackPopularitySimilarity,
      artistPop: artistPopSim,
      era: releaseSimilarity,
      followers: followerSimilarity
    }
  }
}

function computeArtistPopularitySimilarity(
  baseArtistId: string | undefined,
  candidateArtistId: string | undefined,
  artistProfiles: Map<string, ArtistProfile>
): number {
  // If either artist is missing or no popularity data, return neutral
  if (!baseArtistId || !candidateArtistId) {
    return 0.5
  }

  const baseProfile = artistProfiles.get(baseArtistId)
  const candidateProfile = artistProfiles.get(candidateArtistId)

  if (!baseProfile || !candidateProfile) {
    return 0.5
  }

  const basePop = baseProfile.popularity ?? 50
  const candidatePop = candidateProfile.popularity ?? 50

  // Similarity based on popularity difference (0-100 scale)
  const popularityDiff = Math.abs(basePop - candidatePop)
  return Math.max(0, 1 - popularityDiff / 100)
}

export function normalizeGravities(
  gravities: PlayerGravityMap
): PlayerGravityMap {
  return {
    player1: clampGravity(gravities.player1 ?? DEFAULT_PLAYER_GRAVITY),
    player2: clampGravity(gravities.player2 ?? DEFAULT_PLAYER_GRAVITY)
  }
}

export function sourcePriority(source: CandidateSource): number {
  switch (source) {
    case 'target_insertion':
      return 0
    case 'embedding':
      return 1
    case 'recommendations':
      return 2
    case 'related_top_tracks':
    default:
      return 3
  }
}

// Summary statistics
export const calcStats = (scores: number[]) => {
  if (scores.length === 0) return { min: 0, max: 0, avg: 0, median: 0 }
  const sorted = [...scores].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  const median = sorted[Math.floor(sorted.length / 2)]
  return { min, max, avg, median }
}
