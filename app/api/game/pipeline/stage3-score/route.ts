// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { NextRequest, NextResponse } from 'next/server'
import {
  scoreCandidates,
  applyDiversityConstraints,
  ensureTargetDiversity,
  enrichCandidatesWithArtistProfiles,
  computeAttraction
} from '@/services/game/dgsEngine'
import { getGenreStatistics } from '@/services/game/dgsDb'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  PlayerId,
  PlayerGravityMap,
  DgsOptionTrack,
  ArtistProfile,
  CandidateSeed,
  TargetProfile
} from '@/services/game/dgsTypes'
import { TrackDetails } from '@/shared/types/spotify'

const logger = createModuleLogger('Stage3Score')

interface Stage3ScoreRequest {
  seeds: CandidateSeed[]
  profiles: ArtistProfile[]
  targetProfiles: Record<PlayerId, TargetProfile | null>
  playerGravities: PlayerGravityMap
  currentTrack: TrackDetails | null
  relatedArtistIds: string[]
  roundNumber: number
  currentPlayerId: PlayerId
  ogDrift?: number
  hardConvergenceActive?: boolean
  playedTrackIds: string[]
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()

  try {
    const body = (await req.json()) as unknown
    const request = body as Stage3ScoreRequest

    // Validate essential arrays to prevent runtime errors if body is malformed
    if (!Array.isArray(request.seeds) || !Array.isArray(request.profiles)) {
      return NextResponse.json(
        { error: 'Invalid request body: seeds and profiles must be arrays' },
        { status: 400 }
      )
    }

    const {
      seeds: rawSeeds,
      profiles,
      targetProfiles,
      playerGravities,
      currentTrack,
      relatedArtistIds,
      roundNumber,
      currentPlayerId,
      ogDrift,
      hardConvergenceActive,
      playedTrackIds = []
    } = request

    // Filter out played tracks from seeds to be safe
    // This ensures that even if Stage 2 leaked them, we catch them here
    const playedSet = new Set(playedTrackIds)
    // Add current track to exclusion list
    if (currentTrack?.id) {
      playedSet.add(currentTrack.id)
    }

    const seeds = rawSeeds.filter((s) => {
      if (!s.track.id) return false
      return !playedSet.has(s.track.id)
    })

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      )
    }
    const token = authHeader.split(' ')[1]

    // Reconstruct ArtistProfiles Map
    const artistProfilesMap = new Map<string, ArtistProfile>()
    if (Array.isArray(profiles)) {
      profiles.forEach((p: ArtistProfile) => {
        if (p?.id) artistProfilesMap.set(p.id, p)
      })
    }

    // Reconstruct ArtistRelationships Map (Optimized: only map Seed -> Related)
    // scoreCandidates primarily needs to know if Candidate is related to Seed/Base
    const artistRelationships = new Map<string, Set<string>>()
    if (currentTrack?.artists?.[0]?.id && Array.isArray(relatedArtistIds)) {
      artistRelationships.set(
        currentTrack.artists[0].id,
        new Set(relatedArtistIds)
      )
    }

    logger('INFO', `Stage 3: Scoring ${seeds.length} candidates`, 'POST')

    // 0. Pre-calculation for Diversity Injection
    // We need current song attraction to know what is "Good" vs "Bad"
    let currentSongAttraction = 0
    const currentTarget = targetProfiles[currentPlayerId]

    // We need current track metadata/profile to compute attraction
    // Attempt to find current artist profile in the passed profiles
    const currentArtistId = currentTrack?.artists?.[0]?.id
    let currentArtistProfile = currentArtistId
      ? artistProfilesMap.get(currentArtistId)
      : undefined

    if (currentArtistId && !currentArtistProfile) {
      // If missing, we might need to fetch it (or skip injection accuracy)
      if (token) {
        try {
          const { musicService } = await import('@/services/musicService')
          const { data: profile } = await musicService.getArtist(
            currentArtistId,
            token
          )
          if (profile) {
            currentArtistProfile = {
              id: profile.id,
              name: profile.name,
              genres: profile.genres ?? [],
              popularity: profile.popularity ?? 0, // Changed from profile.popularity to profile.popularity ?? 0
              followers: profile.followers
            }
            // Also add to map for later use
            artistProfilesMap.set(currentArtistId, currentArtistProfile)
            logger(
              'INFO',
              `Fetched missing profile for current artist: ${profile.name}`,
              'POST'
            )
          }
        } catch (err) {
          logger(
            'WARN',
            `Failed to fetch current artist profile: ${String(err)}`,
            'POST'
          )
        }
      }
    }

    if (currentArtistProfile && currentTarget) {
      currentSongAttraction = computeAttraction(
        currentArtistProfile,
        currentTarget,
        artistProfilesMap,
        artistRelationships
      ).score
    }

    // 1. Ensure Diversity (Inject candidates if needed)
    // This restores the "Build Pool" logic that was lost in pipeline refactor
    const additionalCandidates = await ensureTargetDiversity({
      candidatePool: seeds,
      targetProfiles,
      currentSongAttraction,
      currentPlayerId,
      currentTrackId: currentTrack?.id ?? '',
      playedTrackIds,
      // Request interface doesn't show it. We might need to add it or ignore.
      // Ignoring means we might suggest duplicates from history, but Stage 2 should have filtered?
      // Let's pass empty for now.
      artistProfiles: artistProfilesMap,
      artistRelationships,
      token,
      statisticsTracker,
      currentArtistId
    })

    if (additionalCandidates.length > 0) {
      logger(
        'INFO',
        `Diversity Injection: Adding ${additionalCandidates.length} generated candidates`,
        'POST'
      )

      // Enrich new candidates
      const newProfiles = await enrichCandidatesWithArtistProfiles(
        additionalCandidates,
        artistProfilesMap,
        token,
        statisticsTracker
      )

      // Merge into main sets
      additionalCandidates.forEach((c) => seeds.push(c))
      newProfiles.forEach((p, id) => artistProfilesMap.set(id, p))
    }

    // 2. Score Candidates (Full Scoring)
    const { metrics, debugInfo: scoringDebug } = await scoreCandidates({
      candidates: seeds,
      playerGravities: playerGravities,
      targetProfiles: targetProfiles,
      artistProfiles: artistProfilesMap,
      artistRelationships,
      currentTrack: currentTrack as TrackDetails,
      currentTrackMetadata: {
        // Minimal metadata if not passed?
        // scoreCandidates extracts metadata from currentTrack usually.
        // But checking signature... it takes 'currentTrackMetadata'.
        // dgsEngine extracts it before calling.
        // We should extract it here using helper?
        // Helper `extractTrackMetadata` is exported in `__dgsTestHelpers`, but also we can import?
        // Ideally we pass it from client or re-extract.
        // dgsEngine has `extractTrackMetadata`.
        // Let's import it or re-implement simple version.
        popularity: currentTrack?.popularity ?? 0,
        duration_ms: currentTrack?.duration_ms ?? 0,
        release_date: currentTrack?.album?.release_date,
        genres: currentArtistProfile?.genres ?? [] // Use genres from profile we looked up
      },
      ogDrift: ogDrift ?? 0,
      hardConvergenceActive: !!hardConvergenceActive,
      roundNumber,
      currentPlayerId,
      token,
      statisticsTracker,
      allowFallback: false
    })

    // 3. Diversity Constraints (Selection)
    const diversityResult = applyDiversityConstraints(
      metrics,
      roundNumber,
      targetProfiles,
      playerGravities,
      currentPlayerId,
      hardConvergenceActive
    )

    // Map to DgsOptionTrack
    const optionTracks: DgsOptionTrack[] = diversityResult.selected.map(
      (metric) => {
        // Simple manual mapping if toOptionTrack is not exported
        const [primaryArtist] = metric.track.artists ?? []
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { track: _track, ...otherMetrics } = metric
        return {
          track: metric.track,
          artist: primaryArtist ?? {
            id: metric.artistId ?? 'unknown',
            name: metric.artistName ?? 'Unknown'
          },
          finalScore: metric.finalScore, // Include finalScore for frontend debugging
          metrics: otherMetrics
        }
      }
    )

    const executionTime = Date.now() - startTime

    logger(
      'INFO',
      `Stage 3 Complete: ${optionTracks.length} options selected (from pool of ${seeds.length}) | Time=${executionTime} ms`,
      'POST'
    )

    // Enrich debug info with filtered status
    const debugCandidates = scoringDebug.candidates.map((c) => ({
      ...c,
      filtered: diversityResult.filteredArtistNames.has(c.artistName)
    }))

    return NextResponse.json({
      optionTracks,
      debug: {
        executionTime,
        stats: statisticsTracker.getStatistics(),
        scoring: {
          ...scoringDebug,
          candidates: undefined // Remove from scoring to match type
        },
        candidates: debugCandidates,
        genreStatistics: await getGenreStatistics()
      }
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Stage 3 Failed: ${errorMsg} `, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
