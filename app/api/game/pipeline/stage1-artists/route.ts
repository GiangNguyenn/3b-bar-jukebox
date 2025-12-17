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
import { fetchRandomArtistsFromDb } from '@/services/game/dgsDb'
import { enqueueLazyUpdate } from '@/services/game/lazyUpdateQueue'

const logger = createModuleLogger('Stage1Artists')

const MIN_TOTAL_ARTISTS = 100
const MAX_RELATED_TO_CURRENT = 50
const MAX_RELATED_TO_TARGET = 20

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()
  resetPerformanceTimings()

  try {
    const body = (await req.json()) as unknown
    const request = body as DualGravityRequest
    const { roundNumber, playerTargets, playbackState } = request

    // Get token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      )
    }
    const token = authHeader.split(' ')[1]

    logger('INFO', `Stage 1 Artists: Round ${roundNumber}`, 'POST')

    // 1. Resolve Target Profiles
    const safeTargets = ensureTargets(playerTargets)
    const targetProfiles = await resolveTargetProfiles(
      safeTargets,
      token,
      statisticsTracker
    )

    // 2. Determine Seed Artist & Current Track
    const currentTrackId = playbackState?.item?.id
    if (!currentTrackId) {
      return NextResponse.json(
        { error: 'No current track found' },
        { status: 400 }
      )
    }

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

    // Validate Spotify ID format
    if (!seedArtistId || seedArtistId.includes('-')) {
      logger(
        'ERROR',
        `Invalid Spotify ID format for seed artist "${seedArtistName}": ${seedArtistId}`,
        'POST'
      )
      return NextResponse.json(
        { error: 'Invalid artist ID - database UUID detected instead of Spotify ID' },
        { status: 400 }
      )
    }

    logger('INFO', `Seed: ${seedArtistName} (${seedArtistId})`, 'POST')

    // 3. Update Gravities
    const updatedGravities = applyGravityUpdates({ request })

    // 4. Get active player info for target artist logic
    const activePlayerId = request.currentPlayerId
    const targetProfile = targetProfiles[activePlayerId]
    const pGravity = updatedGravities[activePlayerId] || 0
    const targetArtistId = targetProfile?.spotifyId

    // Validate target artist ID if present
    if (targetArtistId?.includes('-')) {
      logger(
        'WARN',
        `Invalid Spotify ID format for target artist: ${targetArtistId} - skipping target seeding`,
        'POST'
      )
    }

    // CHECK GRAVITY ZONES (converted to influence):
    // < 0.2 (20% influence): Desperation (Fetch)
    // 0.2 - 0.49 (20-49% influence): Dead Zone (SKIP)
    // >= 0.5 (50%+ influence): Good Influence (Fetch)
    const isInDeadZone = pGravity >= 0.2 && pGravity < 0.5

    // 5. Execute Sub-calls 1.1 and 1.2 in Parallel
    logger('INFO', 'Executing parallel sub-calls 1.1 and 1.2...', 'POST')

    const [relatedToCurrentResult, relatedToTargetResult] = await Promise.all([
      // Sub-call 1.1: Get artists related to currently playing artist
      (async () => {
        try {
          const allRelated = await getSeedRelatedArtists(seedArtistId, token)
          // Limit to MAX_RELATED_TO_CURRENT and return IDs only
          const limited = allRelated.slice(0, MAX_RELATED_TO_CURRENT)
          return {
            artistIds: limited.map((a) => a.id),
            artists: limited
          }
        } catch (error) {
          logger(
            'ERROR',
            `Failed to fetch related artists for current: ${error instanceof Error ? error.message : String(error)}`,
            'POST'
          )
          // Queue for healing if this fails
          if (seedArtistId) {
            void enqueueLazyUpdate({
              type: 'artist_profile',
              spotifyId: seedArtistId,
              payload: { needsRefresh: true, reason: 'related_artists_fetch_failed' }
            })
          }
          return { artistIds: [], artists: [] }
        }
      })(),

      // Sub-call 1.2: Get artists related to target + target itself
      (async () => {
        if (!targetArtistId || !targetProfile?.artist?.name || isInDeadZone) {
          if (isInDeadZone) {
            logger(
              'INFO',
              `Dead Zone Active (Gravity ${pGravity.toFixed(2)}): Skipping Target Artist seeding`,
              'POST'
            )
          }
          return { artistIds: [], artists: [], targetInjected: false }
        }

        try {
          logger(
            'INFO',
            `Seeding from Target Artist: ${targetProfile.artist.name} (${targetArtistId}) - Gravity ${pGravity.toFixed(2)}`,
            'POST'
          )

          const allRelated = await getSeedRelatedArtists(targetArtistId, token)
          const limited = allRelated.slice(0, MAX_RELATED_TO_TARGET)

          // Check if target should be injected directly
          const highInfluenceGravityThreshold = 0.59 // 80% influence
          const roundThreshold = 10
          const isHighInfluence = pGravity > highInfluenceGravityThreshold
          const isRoundThresholdMet = roundNumber >= roundThreshold
          const shouldInjectTarget = isHighInfluence || isRoundThresholdMet

          const artistIds = limited.map((a) => a.id)
          const artists = [...limited]

          if (shouldInjectTarget) {
            // Add target artist itself if not already in list
            if (!artistIds.includes(targetArtistId)) {
              artistIds.push(targetArtistId)
              artists.push({
                id: targetArtistId,
                name: targetProfile.artist.name
              })
              logger(
                'INFO',
                `Target Artist Injection (Gravity ${pGravity.toFixed(2)} > ${highInfluenceGravityThreshold} OR Round ${roundNumber} >= ${roundThreshold}): Forcibly injecting target artist: ${targetProfile.artist.name}`,
                'POST'
              )
            }
          }

          return {
            artistIds,
            artists,
            targetInjected: shouldInjectTarget
          }
        } catch (error) {
          logger(
            'ERROR',
            `Failed to fetch related artists for target: ${error instanceof Error ? error.message : String(error)}`,
            'POST'
          )
          // Queue for healing
          if (targetArtistId) {
            void enqueueLazyUpdate({
              type: 'artist_profile',
              spotifyId: targetArtistId,
              payload: { needsRefresh: true, reason: 'related_artists_fetch_failed' }
            })
          }
          return { artistIds: [], artists: [], targetInjected: false }
        }
      })()
    ])

    const relatedToCurrent = relatedToCurrentResult.artists
    const relatedToTarget = relatedToTargetResult.artists
    const targetInjected = relatedToTargetResult.targetInjected

    // 6. After 1.1 and 1.2 Complete, Execute Sub-call 1.3 Sequentially
    logger('INFO', 'Executing sequential sub-call 1.3 (random artists)...', 'POST')

    // Build exclusion set from 1.1 and 1.2 results
    const existingArtistIds = new Set<string>()
    relatedToCurrentResult.artistIds.forEach((id) => existingArtistIds.add(id))
    relatedToTargetResult.artistIds.forEach((id) => existingArtistIds.add(id))

    // Calculate how many random artists are needed
    const currentCount = existingArtistIds.size
    const neededRandomArtists = Math.max(0, MIN_TOTAL_ARTISTS - currentCount)

    let randomArtists: Array<{ id: string; name: string }> = []
    const pipelineLogs: Array<{
      stage: 'stage1' | 'stage2' | 'stage3' | 'engine'
      level: 'info' | 'warn' | 'error'
      message: string
      timestamp: number
    }> = []

    if (neededRandomArtists > 0) {
      logger('INFO', `Adding ${neededRandomArtists} random artists to reach minimum of ${MIN_TOTAL_ARTISTS} artists`, 'POST')

      try {
        const dbResult = await fetchRandomArtistsFromDb({
          limit: neededRandomArtists,
          excludeArtistIds: existingArtistIds,
          statisticsTracker
        })

        const randomArtistsFromDb = dbResult.artists
        const dbLogs = dbResult.logs

        // Capture logs from DB for debug panel
        if (dbLogs) {
          dbLogs.forEach((msg) => {
            pipelineLogs.push({
              stage: 'engine',
              level: 'info',
              message: msg,
              timestamp: Date.now()
            })
          })
        }

        randomArtists = randomArtistsFromDb.map((artist) => ({
          id: artist.id,
          name: artist.name
        }))

        logger('INFO', `Added ${randomArtists.length} random artists from database`, 'POST')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger('ERROR', `Failed to fetch random artists: ${errorMsg}`, 'POST')
      }
    } else {
      logger('INFO', `Already have ${currentCount} artists, no random artists needed`, 'POST')
    }

    // 7. Combine all artists and ensure uniqueness
    const combinedMap = new Map<string, { id: string; name: string }>()
    relatedToCurrent.forEach((a) => combinedMap.set(a.id, a))
    relatedToTarget.forEach((a) => combinedMap.set(a.id, a))
    randomArtists.forEach((a) => combinedMap.set(a.id, a))

    const artistIds = Array.from(combinedMap.keys())
    const finalCount = artistIds.length

    logger(
      'INFO',
      `Total unique candidate artists: ${finalCount} (${relatedToCurrent.length} from current, ${relatedToTarget.length} from target${targetInjected ? ' (target injected)' : ''}, ${randomArtists.length} random)`,
      'POST'
    )

    // 8. Game Parameters
    const explorationPhase = getExplorationPhase(roundNumber)
    const ogDrift = 0 // Placeholder - can be calculated if needed
    const hardConvergenceActive = roundNumber >= MAX_ROUND_TURNS

    const executionTime = Date.now() - startTime

    // Self-Healing: Process healing queue during active gameplay (non-blocking)
    const timeRemaining = 10000 - executionTime
    if (timeRemaining > 1000) {
      const { processHealingQueue } = await import(
        '@/services/game/selfHealing'
      )
      void processHealingQueue(token, 2)
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
      artistIds, // Exactly 100 unique artist IDs (or as close as possible)
      relatedToCurrent: relatedToCurrent.map((a) => ({ name: a.name, id: a.id })),
      relatedToTarget: relatedToTarget.map((a) => ({ name: a.name, id: a.id })),
      randomArtists: randomArtists.map((a) => ({ name: a.name, id: a.id })),
      targetProfiles,
      currentTrack,
      seedArtistId,
      seedArtistName,
      updatedGravities,
      explorationPhase,
      hardConvergenceActive,
      ogDrift,
      debug: {
        executionTimeMs: executionTime,
        caching: statisticsTracker.getStatistics(),
        performanceDiagnostics: statisticsTracker.getPerformanceDiagnostics(),
        candidatePool: {
          totalUnique: finalCount,
          relatedToCurrent: relatedToCurrent.map((a) => ({ name: a.name, id: a.id })),
          relatedToTarget: relatedToTarget.map((a) => ({ name: a.name, id: a.id })),
          randomArtists: randomArtists.map((a) => ({ name: a.name, id: a.id }))
        },
        pipelineLogs
      }
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Stage 1 Artists Failed: ${errorMsg}`, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
