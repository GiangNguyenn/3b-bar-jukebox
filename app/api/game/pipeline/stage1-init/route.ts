import { NextRequest, NextResponse } from 'next/server'

import {
  resolveTargetProfiles,
  getSeedRelatedArtists,
  applyGravityUpdates,
  ensureTargets,
  resetPerformanceTimings
} from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { getExplorationPhase, MAX_ROUND_TURNS } from '@/services/game/gameRules'
import { musicService } from '@/services/musicService'
import { createModuleLogger } from '@/shared/utils/logger'
import { DualGravityRequest } from '@/services/game/dgsTypes'

const logger = createModuleLogger('Stage1Init')

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()
  resetPerformanceTimings() // Global reset if needed, though mostly per-request via tracker

  try {
    const body = (await req.json()) as unknown
    const request = body as DualGravityRequest
    const { roundNumber, playerTargets, playbackState } = request

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

    // CRITICAL: Validate that we have a Spotify ID, not a database UUID
    // Spotify IDs are base62 (alphanumeric, no dashes), typically 22 chars
    // Database UUIDs have dashes (e.g., "550e8400-e29b-41d4-a716-446655440000")
    if (!seedArtistId || seedArtistId.includes('-')) {
      logger(
        'ERROR',
        `Invalid Spotify ID format for seed artist "${seedArtistName}": ${seedArtistId} (looks like database UUID)`,
        'POST'
      )
      return NextResponse.json(
        {
          error:
            'Invalid artist ID - database UUID detected instead of Spotify ID'
        },
        { status: 400 }
      )
    }

    logger('INFO', `Seed: ${seedArtistName} (${seedArtistId})`, 'POST')

    // 3. Update Gravities (Calculate early to use for seeding logic)
    // This calculates the NEW gravities based on the PREVIOUS selection
    const updatedGravities = applyGravityUpdates({ request })

    // 4. Get Related Artist IDs (for Stage 2)
    const activePlayerId = request.currentPlayerId
    const targetProfile = targetProfiles[activePlayerId]
    const pGravity = updatedGravities[activePlayerId] || 0

    // Only use target artist if profile was successfully resolved
    const targetArtistId = targetProfile?.spotifyId

    // Validate target artist ID if present
    if (targetArtistId?.includes('-')) {
      logger(
        'WARN',
        `Invalid Spotify ID format for target artist: ${targetArtistId} (looks like database UUID) - skipping target seeding`,
        'POST'
      )
    }

    // CHECK GRAVITY ZONES:
    // < 0.2: Desperation (Fetch)
    // 0.2 - 0.39: Dead Zone (SKIP)
    // 0.4 - 0.79: Good Influence (Fetch)
    // >= 0.8: High Influence (Fetch + Inject later)
    const isInDeadZone = pGravity >= 0.2 && pGravity < 0.4

    // Fetch seed artists (always)
    const seedArtists = await getSeedRelatedArtists(seedArtistId, token)

    // Fetch target artists (conditional)
    let targetArtists: Array<{ id: string; name: string }> = []

    if (targetArtistId && targetProfile?.artist?.name) {
      if (isInDeadZone) {
        logger(
          'INFO',
          `Dead Zone Active (Gravity ${pGravity.toFixed(2)}): Skipping Target Artist seeding for ${targetProfile.artist.name}`,
          'POST'
        )
      } else {
        logger(
          'INFO',
          `Seeding from Target Artist: ${targetProfile.artist.name} (${targetArtistId}) - Gravity ${pGravity.toFixed(2)}`,
          'POST'
        )
        try {
          targetArtists = await getSeedRelatedArtists(targetArtistId, token)
        } catch (error) {
          logger(
            'ERROR',
            `Failed to fetch related artists for target: ${error instanceof Error ? error.message : String(error)}`,
            'POST'
          )
        }
      }
    } else {
      logger(
        'WARN',
        `Target artist not resolved for ${activePlayerId}, skipping target-based seeding`,
        'POST'
      )
    }

    // Merge and deduplicate for Stage 2
    const combinedMap = new Map<string, { id: string; name: string }>()
    seedArtists.forEach((a) => combinedMap.set(a.id, a))
    targetArtists.forEach((a) => combinedMap.set(a.id, a))

    // CRITICAL: Target Artist Injection Logic
    // Per requirements 3.4.2: Target Artist tracks should ONLY be forcibly injected at ≥ 80% gravity
    // At all other gravity levels, target artist can only appear if it's naturally in related artists
    const highInfluenceThreshold = 0.8
    const isHighInfluence = pGravity >= highInfluenceThreshold

    if (targetArtistId && targetProfile?.artist?.name) {
      if (isHighInfluence) {
        combinedMap.set(targetArtistId, {
          id: targetArtistId,
          name: targetProfile.artist.name
        })
        logger(
          'INFO',
          `High Influence (Gravity ${pGravity.toFixed(2)} ≥ ${highInfluenceThreshold}): Forcibly injecting target artist: ${targetProfile.artist.name}`,
          'POST'
        )
      } else {
        logger(
          'INFO',
          `Gravity ${pGravity.toFixed(2)} < ${highInfluenceThreshold}: Target artist NOT forcibly injected (${targetProfile.artist.name} can only appear if naturally related)`,
          'POST'
        )
      }
    }

    const relatedArtistIds = Array.from(combinedMap.keys())
    logger(
      'INFO',
      `Total unique candidate artists: ${relatedArtistIds.length} (${seedArtists.length} from seed, ${targetArtists.length} from target, +1 target itself)`,
      'POST'
    )

    // 5. Game Parameters
    const explorationPhase = getExplorationPhase(roundNumber)
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

    // Self-Healing: Process healing queue during active gameplay
    // This runs in the background without blocking the response
    const timeRemaining = 10000 - executionTime // Vercel 10s limit

    if (timeRemaining > 1000) {
      // Only if we have at least 1s remaining
      const { processHealingQueue } = await import(
        '@/services/game/selfHealing'
      )
      // Process healing asynchronously (don't await - fire and forget)
      processHealingQueue(token, 2)
        .then((results) => {
          if (results.processed > 0) {
            logger(
              'INFO',
              `Background healing: processed=${results.processed}, succeeded=${results.succeeded}, failed=${results.failed}`,
              'POST'
            )
          }
        })
        .catch((error) => {
          logger(
            'ERROR',
            `Background healing failed: ${error instanceof Error ? error.message : String(error)}`,
            'POST'
          )
        })
    }

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
        stats: statisticsTracker.getStatistics(),
        candidatePool: {
          totalUnique: relatedArtistIds.length,
          seedArtists,
          targetArtists
        }
      }
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Stage 1 Failed: ${errorMsg} `, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
