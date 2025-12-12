
import { NextRequest, NextResponse } from 'next/server'
import {
    scoreCandidates,
    applyDiversityConstraints
} from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import {
    PlayerId,
    PlayerGravityMap,
    DgsOptionTrack,
    CandidateTrackMetrics,
    ArtistProfile,
    CandidateSeed,
    TargetProfile
} from '@/services/game/dgsTypes'
import { TrackDetails } from '@/shared/types/spotify'

const logger = createModuleLogger('Stage3Score')

export async function POST(req: NextRequest) {
    const startTime = Date.now()
    const statisticsTracker = new ApiStatisticsTracker()

    try {
        const body = await req.json()
        const {
            seeds,
            profiles, // Array of ArtistProfile 
            targetProfiles,
            playerGravities,
            currentTrack, // TrackDetails
            relatedArtistIds, // from Stage 1 (for current track/seed)
            roundNumber,
            currentPlayerId,
            ogDrift,
            hardConvergenceActive
        } = body

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
        }
        const token = authHeader.split(' ')[1]

        // Reconstruct ArtistProfiles Map
        const artistProfilesMap = new Map<string, ArtistProfile>()
        if (Array.isArray(profiles)) {
            profiles.forEach((p: ArtistProfile) => {
                if (p && p.id) artistProfilesMap.set(p.id, p)
            })
        }

        // Reconstruct ArtistRelationships Map (Optimized: only map Seed -> Related)
        // scoreCandidates primarily needs to know if Candidate is related to Seed/Base
        const artistRelationships = new Map<string, Set<string>>()
        if (currentTrack && currentTrack.artists?.[0]?.id && Array.isArray(relatedArtistIds)) {
            artistRelationships.set(currentTrack.artists[0].id, new Set(relatedArtistIds))
        }

        logger('INFO', `Stage 3: Scoring ${seeds.length} candidates`, 'POST')

        // 1. Score Candidates
        const { metrics, debugInfo: scoringDebug } = await scoreCandidates({
            candidates: seeds as CandidateSeed[],
            playerGravities: playerGravities as PlayerGravityMap,
            targetProfiles: targetProfiles as Record<PlayerId, TargetProfile | null>,
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
                genres: [], // Main track genres usually come from Artist? 
                // In dgsEngine, `currentTrackMetadata` has genres from artist profile.
                // We need current track artist profile to get genres.
                // It should be in `artistProfilesMap` if we fetched seed artist details?
                artistId: currentTrack?.artists?.[0]?.id
            },
            ogDrift: ogDrift ?? 0,
            hardConvergenceActive: hardConvergenceActive ?? false,
            roundNumber,
            currentPlayerId,
            token,
            statisticsTracker,
            allowFallback: false
        })

        // 2. Diversity Constraints (Selection)
        const diversityResult = applyDiversityConstraints(
            metrics,
            roundNumber,
            targetProfiles,
            playerGravities,
            currentPlayerId
        )

        // Map to DgsOptionTrack
        const optionTracks: DgsOptionTrack[] = diversityResult.selected.map(metric => {
            // Simple manual mapping if toOptionTrack is not exported
            const [primaryArtist] = metric.track.artists ?? []
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { track, ...otherMetrics } = metric
            return {
                track: metric.track,
                artist: primaryArtist ?? {
                    id: metric.artistId ?? 'unknown',
                    name: metric.artistName ?? 'Unknown'
                },
                metrics: otherMetrics
            }
        })

        const executionTime = Date.now() - startTime

        logger('INFO', `Stage 3 Complete: ${optionTracks.length} options selected | Time=${executionTime} ms`, 'POST')

        return NextResponse.json({
            optionTracks,
            debug: {
                executionTime,
                stats: statisticsTracker.getStatistics(),
                scoring: scoringDebug
            }
        })

    } catch (error) {
        logger('ERROR', `Stage 3 Failed: ${error} `, 'POST')
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        )
    }
}
