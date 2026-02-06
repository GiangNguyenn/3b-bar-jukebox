import { NextRequest, NextResponse } from 'next/server'
import {
  computeAttraction,
  computeStrictArtistSimilarity
} from '@/services/game/dgsScoring'
import { applyDiversityConstraints } from '@/services/game/dgsDiversity'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  PlayerId,
  PlayerGravityMap,
  ArtistProfile,
  TargetProfile,
  CandidateTrackMetrics,
  ScoringComponents
} from '@/services/game/dgsTypes'
import { DUMMY_COMPONENTS } from '@/services/game/dgsScoring'
import { TrackDetails } from '@/shared/types/spotify'
import { batchGetArtistProfilesWithCache } from '@/services/game/dgsCache'
import { enqueueLazyUpdate } from '@/services/game/lazyUpdateQueue'
import { MAX_ROUND_TURNS } from '@/services/game/gameRules'

const logger = createModuleLogger('Stage2ScoreArtists')

interface Stage2ScoreArtistsRequest {
  artistIds: string[]
  targetProfiles: Record<PlayerId, TargetProfile | null>
  playerGravities: PlayerGravityMap
  currentTrack: TrackDetails | null
  relatedArtistIds: string[] // For relationship mapping
  roundNumber: number
  currentPlayerId: PlayerId
  ogDrift?: number
  hardConvergenceActive?: boolean
  relatedToCurrent?: Array<{ name: string; id: string }>
  relatedToTarget?: Array<{ name: string; id: string }>
  randomArtists?: Array<{ name: string; id: string }>
}

interface ArtistScore {
  artistId: string
  artistName: string
  artistProfile: ArtistProfile | undefined
  attractionScore: number // Artist-to-artist similarity to target
  delta: number // Difference from baseline
  category: 'CLOSER' | 'NEUTRAL' | 'FURTHER'
  source: 'related_top_tracks' | 'target_insertion' | 'embedding'
  isTargetArtist: boolean
  filtered: boolean
  scoreComponents?: ScoringComponents
  currentTrackSimilarity: number // Similarity to valid current track (for filtering)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()

  try {
    const body = (await req.json()) as unknown
    const request = body as Stage2ScoreArtistsRequest

    if (!Array.isArray(request.artistIds)) {
      return NextResponse.json(
        { error: 'Invalid request body: artistIds must be an array' },
        { status: 400 }
      )
    }

    const {
      artistIds,
      targetProfiles,
      playerGravities,
      currentTrack,
      relatedArtistIds,
      roundNumber,
      currentPlayerId,
      hardConvergenceActive = false,
      relatedToCurrent = [],
      relatedToTarget = [],
      randomArtists = []
    } = request

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      )
    }
    const token = authHeader.split(' ')[1]

    logger(
      'INFO',
      `Stage 2: Received request for ${artistIds.length} artists`,
      'POST'
    )

    // Log first few IDs for debugging
    if (artistIds.length > 0) {
      logger('INFO', `First 3 IDs: ${artistIds.slice(0, 3).join(', ')}`, 'POST')
    }

    logger('INFO', `Stage 2: Scoring ${artistIds.length} artists`, 'POST')

    // 1. Fetch Artist Profiles for all 100 artists
    // Data Strategy: Tier 1 (Cache) → Tier 2 (DB) → Tier 3 (Spotify API)
    const artistProfilesMap = new Map<string, ArtistProfile>()
    const missingProfileIds: string[] = []

    // Track requests
    artistIds.forEach(() => {
      statisticsTracker.recordRequest('artistProfiles')
    })

    // Prepare list of IDs to fetch, including the seed artist (current track's artist)
    // This is critical for calculating baseline attraction
    const idsToFetch = new Set(artistIds)
    if (currentTrack?.artists?.[0]?.id) {
      idsToFetch.add(currentTrack.artists[0].id)
    }

    try {
      const fetchedProfiles = await batchGetArtistProfilesWithCache(
        Array.from(idsToFetch),
        token,
        statisticsTracker
      )

      fetchedProfiles.forEach((profile, id) => {
        artistProfilesMap.set(id, {
          id: profile.id,
          name: profile.name,
          genres: profile.genres,
          popularity: profile.popularity,
          followers: profile.followers
        })
      })

      // Track missing profiles for self-healing
      artistIds.forEach((id) => {
        if (!artistProfilesMap.has(id)) {
          missingProfileIds.push(id)
        }
      })

      // Queue missing profiles for healing (REQ-DAT-03)
      missingProfileIds.forEach((id) => {
        void enqueueLazyUpdate({
          type: 'artist_profile',
          spotifyId: id,
          payload: { needsRefresh: true, reason: 'missing_profile' }
        })
      })

      logger(
        'INFO',
        `Fetched ${artistProfilesMap.size}/${artistIds.length} artist profiles (${missingProfileIds.length} missing, queued for healing)`,
        'POST'
      )
    } catch (error) {
      logger(
        'ERROR',
        `Failed to fetch artist profiles: ${error instanceof Error ? error.message : String(error)}`,
        'POST'
      )
      // Continue with what we have
    }

    // 2. Build ArtistRelationships Map for scoring
    const artistRelationships = new Map<string, Set<string>>()
    if (currentTrack?.artists?.[0]?.id && Array.isArray(relatedArtistIds)) {
      artistRelationships.set(
        currentTrack.artists[0].id,
        new Set(relatedArtistIds)
      )
    }

    // 3. Calculate Baseline: Current song's artist to target artist
    const currentTarget = targetProfiles[currentPlayerId]
    const currentArtistId = currentTrack?.artists?.[0]?.id
    const currentArtistProfile = currentArtistId
      ? artistProfilesMap.get(currentArtistId)
      : undefined

    let baselineAttraction = 0
    if (currentArtistProfile && currentTarget) {
      const baselineResult = computeAttraction(
        currentArtistProfile,
        currentTarget,
        artistProfilesMap,
        artistRelationships
      )
      baselineAttraction = baselineResult.score
      logger(
        'INFO',
        `Baseline attraction (current artist to target): ${baselineAttraction.toFixed(3)}`,
        'POST'
      )
    }

    // 4. Score all artists
    const NEUTRAL_TOLERANCE = 0.05 // From requirements
    const artistScores: ArtistScore[] = []
    const zeroAttractionReasons = {
      missingArtistProfile: 0,
      nullTargetProfile: 0,
      zeroSimilarity: 0
    }

    // Build source map for debug info
    const sourceMap = new Map<
      string,
      'related_top_tracks' | 'target_insertion' | 'embedding'
    >()
    relatedToCurrent.forEach((a) => sourceMap.set(a.id, 'related_top_tracks'))
    relatedToTarget.forEach((a) => sourceMap.set(a.id, 'target_insertion'))
    randomArtists.forEach((a) => sourceMap.set(a.id, 'embedding'))

    artistIds.forEach((artistId) => {
      const artistProfile = artistProfilesMap.get(artistId)
      const artistName = artistProfile?.name ?? 'Unknown Artist'
      const source = sourceMap.get(artistId) ?? 'embedding'

      // Track zero attraction reasons
      if (!artistProfile) {
        zeroAttractionReasons.missingArtistProfile++
      }
      if (!currentTarget) {
        zeroAttractionReasons.nullTargetProfile++
      }

      // Calculate attraction score
      const attractionResult = computeAttraction(
        artistProfile,
        currentTarget,
        artistProfilesMap,
        artistRelationships
      )
      const attractionScore = attractionResult.score
      const scoreComponents = attractionResult.components

      // ACID TEST: Calculate similarity to CURRENT artist (for filtering)
      // This is crucial because Attraction Score (Target <-> Target) is always 1.0
      // We must filter based on whether the target is similar to the CURRENT song.
      let currentTrackSimilarity = 0
      if (currentArtistProfile && artistProfile) {
        const simResult = computeStrictArtistSimilarity(
          currentArtistProfile,
          artistProfile,
          artistProfilesMap,
          artistRelationships
        )
        currentTrackSimilarity = simResult.score
      }

      // Calculate delta from baseline
      const delta = attractionScore - baselineAttraction

      // Determine category
      let category: 'CLOSER' | 'NEUTRAL' | 'FURTHER'
      if (delta > NEUTRAL_TOLERANCE) {
        category = 'CLOSER'
      } else if (delta < -NEUTRAL_TOLERANCE) {
        category = 'FURTHER'
      } else {
        category = 'NEUTRAL'
      }

      // Check if this is a target artist
      const isTargetArtist = Object.values(targetProfiles).some((target) => {
        if (!target) return false
        if (target.spotifyId && artistId && target.spotifyId === artistId) {
          return true
        }
        // Fallback to name match
        return (
          target.artist.name.toLowerCase().trim() ===
          artistName.toLowerCase().trim()
        )
      })

      // Track zero similarity (when profiles exist but similarity is 0)
      if (artistProfile && currentTarget && attractionScore === 0) {
        zeroAttractionReasons.zeroSimilarity++
      }

      artistScores.push({
        artistId,
        artistName,
        artistProfile,
        attractionScore,
        currentTrackSimilarity,
        delta,
        category,
        source,
        isTargetArtist,
        filtered: false, // Will be set during filtering
        scoreComponents
      })
    })

    logger(
      'INFO',
      `Scored ${artistScores.length} artists: ${artistScores.filter((a) => a.category === 'CLOSER').length} CLOSER, ${artistScores.filter((a) => a.category === 'NEUTRAL').length} NEUTRAL, ${artistScores.filter((a) => a.category === 'FURTHER').length} FURTHER`,
      'POST'
    )

    // 5. Apply Filtering Rules
    // Exclude current artist
    const currentArtistFiltered = artistScores.filter(
      (score) => score.artistId !== currentArtistId
    )

    // Apply REQ-FUN-07: Target artist filtering based on round/influence
    const SIMILARITY_THRESHOLD = 0.4
    const filteredScores = currentArtistFiltered.filter((score) => {
      // In round 10+, allow all target artists naturally
      if (hardConvergenceActive || roundNumber >= MAX_ROUND_TURNS) {
        return true
      }

      // If not a target artist, allow it
      if (!score.isTargetArtist) {
        return true
      }

      // CHECK OVERRIDES: Round 10+ OR High Influence (> 0.59 = 80% influence)
      const roundOverride = roundNumber >= 10
      const gravityOverride =
        currentPlayerId && playerGravities[currentPlayerId] > 0.59

      if (roundOverride || gravityOverride) {
        return true
      }

      // If it's a target artist in early rounds, only allow if similarity to CURRENT TRACK is high
      // FIX: Previously used attractionScore (Target <-> Target = 1.0), which always passed
      const allowed = score.currentTrackSimilarity > SIMILARITY_THRESHOLD
      if (!allowed) {
        score.filtered = true
      }
      return allowed
    })

    logger(
      'INFO',
      `After filtering: ${filteredScores.length} artists (filtered ${currentArtistFiltered.length - filteredScores.length})`,
      'POST'
    )

    // 6. Convert to CandidateTrackMetrics format for applyDiversityConstraints
    // We need to create a minimal track-like structure
    const metrics: CandidateTrackMetrics[] = filteredScores.map((score) => {
      // Create a minimal track structure for diversity constraints
      // The diversity function expects tracks but we're working with artists
      // We'll use a placeholder track structure - the actual track will be fetched in Stage 3
      return {
        track: {
          id: `artist-placeholder-${score.artistId}`, // Placeholder ID
          name: score.artistName, // Use artist name as track name placeholder
          uri: `spotify:artist:${score.artistId}`, // Placeholder URI
          artists: score.artistProfile
            ? [
                {
                  id: score.artistProfile.id,
                  name: score.artistProfile.name
                }
              ]
            : [],
          album: { id: '', name: '', images: [], release_date: '2000-01-01' },
          duration_ms: 0,
          popularity: 0,
          preview_url: null,
          external_urls: { spotify: '' },
          is_playable: true,
          explicit: false
        } as unknown as TrackDetails,
        source: score.source, // Required field
        artistName: score.artistName,
        artistId: score.artistId,
        simScore: score.currentTrackSimilarity, // Use specific similarity to current track
        aAttraction: score.attractionScore,
        bAttraction: score.attractionScore,
        currentSongAttraction: baselineAttraction,
        selectionCategory:
          score.category === 'CLOSER'
            ? 'closer'
            : score.category === 'NEUTRAL'
              ? 'neutral'
              : 'further',
        gravityScore: 0, // Not used for artist selection
        stabilizedScore: 0, // Not used for artist selection
        finalScore: score.attractionScore, // Use attraction as final score (goal proximity)
        scoreComponents: score.scoreComponents ?? DUMMY_COMPONENTS,
        popularityBand: 'mid' as const,
        vicinityDistances: {}
      }
    })

    // 7. Apply 3-3-3 Distribution using existing function
    const diversityResult = applyDiversityConstraints(
      metrics,
      roundNumber,
      targetProfiles,
      playerGravities,
      currentPlayerId,
      hardConvergenceActive
    )

    // 8. Map back to selected artists
    const mapToSelectedArtist = (
      metric: CandidateTrackMetrics
    ): {
      artistId: string
      artistName: string
      category: string
      attractionScore: number
      delta: number
      scoreComponents: ScoringComponents
    } => {
      // Extract artist ID from placeholder track ID or use artistId field
      const artistIdFromPlaceholder = metric.track.id?.replace(
        'artist-placeholder-',
        ''
      )
      const artistId =
        metric.artistId ??
        artistIdFromPlaceholder ??
        metric.track.artists?.[0]?.id

      const originalScore = artistScores.find(
        (s) => s.artistId === artistId || s.artistName === metric.artistName
      )
      return {
        artistId: originalScore?.artistId ?? artistId ?? 'unknown',
        artistName: originalScore?.artistName ?? metric.artistName ?? 'Unknown',
        category:
          metric.selectionCategory === 'closer'
            ? 'CLOSER'
            : metric.selectionCategory === 'neutral'
              ? 'NEUTRAL'
              : 'FURTHER',
        attractionScore: originalScore?.attractionScore ?? metric.simScore,
        delta:
          originalScore?.delta ??
          (metric.currentSongAttraction !== undefined
            ? metric.aAttraction - metric.currentSongAttraction
            : 0),
        scoreComponents:
          originalScore?.scoreComponents ??
          metric.scoreComponents ??
          DUMMY_COMPONENTS
      }
    }

    const selectedArtists = diversityResult.selected.map(mapToSelectedArtist)
    const backupArtists = diversityResult.remaining.map(mapToSelectedArtist)

    logger(
      'INFO',
      `Selected ${selectedArtists.length} artists: ${selectedArtists.filter((a) => a.category === 'CLOSER').length} CLOSER, ${selectedArtists.filter((a) => a.category === 'NEUTRAL').length} NEUTRAL, ${selectedArtists.filter((a) => a.category === 'FURTHER').length} FURTHER. Backup candidates: ${backupArtists.length}`,
      'POST'
    )

    const executionTime = Date.now() - startTime

    // Build debug info
    const debugInfo = {
      executionTimeMs: executionTime,
      caching: statisticsTracker.getStatistics(),
      performanceDiagnostics: statisticsTracker.getPerformanceDiagnostics(),
      scoring: {
        totalCandidates: artistScores.length,
        fallbackFetches: 0,
        p1NonZeroAttraction: artistScores.filter((s) => s.attractionScore > 0)
          .length,
        p2NonZeroAttraction: artistScores.filter((s) => s.attractionScore > 0)
          .length,
        zeroAttractionReasons
      },
      candidates: artistScores.map((score) => ({
        artistName: score.artistName,
        artistId: score.artistId,
        source: score.source,
        simScore: score.attractionScore,
        delta: score.delta,
        category:
          score.category === 'CLOSER'
            ? 'closer'
            : score.category === 'NEUTRAL'
              ? 'neutral'
              : 'further',
        isTargetArtist: score.isTargetArtist,
        filtered: score.filtered
      })),
      selectedArtists,
      backupArtists
    }

    return NextResponse.json({
      selectedArtists,
      backupArtists,
      debugInfo
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Stage 2 Score Artists Failed: ${errorMsg}`, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
