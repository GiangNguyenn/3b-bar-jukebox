import { NextRequest, NextResponse } from 'next/server'

import { cookies } from 'next/headers'
import {
  resolveTargetProfiles,
  getSeedRelatedArtistIds,
  applyGravityUpdates,
  normalizeGravities,
  ensureTargets,
  resetPerformanceTimings
} from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { getExplorationPhase, MAX_ROUND_TURNS } from '@/services/game/gameRules'
import { musicService } from '@/services/musicService'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  DualGravityRequest,
  DualGravityResponse
} from '@/services/game/dgsTypes'

const logger = createModuleLogger('Stage1Init')

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()
  resetPerformanceTimings() // Global reset if needed, though mostly per-request via tracker

  try {
    const body = await req.json()
    const request = body as DualGravityRequest
    const { roundNumber, playerTargets, playbackState, playerGravities } =
      request

    // Get Admin Token (similar to existing init-round)
    // NOTE: In production we might want to pass this from client or secure it better,
    // but sticking to existing pattern of using server-side admin token or user token.
    // Existing init-round uses: const token = authHeader.split(' ')[1] OR admin token.
    // We'll trust the caller to provide valid token or use our internal service.
    // Actually, dgsEngine usually expects a valid Spotify token.
    // We'll check headers.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      )
    }
    const token = authHeader.split(' ')[1]

    logger('INFO', `Stage 1 Init: Round ${roundNumber} `, 'POST')

    // 1. Resolve Target Profiles (Parallelizable with Seed determination, but let's keep simple)
    // Ensure targets are valid
    const safeTargets = ensureTargets(playerTargets)
    const targetProfiles = await resolveTargetProfiles(
      safeTargets,
      token,
      statisticsTracker
    )

    // 2. Determine Seed Artist & Current Track
    // We need current track ID from playback/request
    const currentTrackId = playbackState?.item?.id
    if (!currentTrackId) {
      return NextResponse.json(
        { error: 'No current track found' },
        { status: 400 }
      )
    }

    // Fetch track details to get Artist ID reliably
    const { data: currentTrack } = await musicService.getTrack(
      currentTrackId,
      token
    )
    if (!currentTrack || !currentTrack.artists?.[0]?.id) {
      return NextResponse.json(
        { error: 'Invalid current track or missing artist' },
        { status: 400 }
      )
    }

    const seedArtistId = currentTrack.artists[0].id
    const seedArtistName = currentTrack.artists[0].name

    logger('INFO', `Seed: ${seedArtistName} (${seedArtistId})`, 'POST')

    // 3. Get Related Artist IDs (for Stage 2)
    // We only fetch IDs here. Client will orchestrate fetching tracks (Stage 2)
    const relatedArtistIds = await getSeedRelatedArtistIds(seedArtistId, token)

    // 4. Update Gravities
    // This calculates the NEW gravities based on the PREVIOUS selection (passed in request.lastSelection)
    const updatedGravities = applyGravityUpdates({ request })

    // 5. Game Parameters
    const explorationPhase = getExplorationPhase(roundNumber, updatedGravities)
    // OG Drift logic (simplified replicate from engine)
    // Calculate drift based on current track attributes vs targets?
    // For now we can skip complex drift calc or do it if needed.
    // The engine does: const ogDrift = calculateDrift(...)
    // Let's defer strict drift calc if not strictly needed for Stage 2.
    // Actually Stage 3 uses it for scoring.
    // We can calculate it here or in Stage 3. Stage 3 has all candidates, might be better there?
    // But Stage 3 needs 'ogDrift' passed to it.
    // Let's default to 0 for now or calculate if simple.
    const ogDrift = 0 // Placeholder

    const hardConvergenceActive = roundNumber >= MAX_ROUND_TURNS

    const executionTime = Date.now() - startTime

    return NextResponse.json({
      targetProfiles,
      seedArtistId,
      seedArtistName,
      currentTrack, // Pass fully resolved track for Stage 3
      relatedArtistIds,
      updatedGravities,
      explorationPhase,
      hardConvergenceActive,
      ogDrift,
      debug: {
        executionTime,
        stats: statisticsTracker.getStatistics()
      }
    })
  } catch (error) {
    logger('ERROR', `Stage 1 Failed: ${error} `, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
