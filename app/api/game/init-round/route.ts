import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { getCurrentArtistId } from '@/services/gameService'
import {
  DEFAULT_PLAYER_GRAVITY,
  type DualGravityRequest,
  type PlayerGravityMap,
  type PlayerTargetsMap
} from '@/services/game/dgsTypes'
import { runDualGravityEngine } from '@/services/game/dgsEngine'
import { getAdminToken } from '@/services/game/adminAuth'
import { createModuleLogger } from '@/shared/utils/logger'
import { fetchAbsoluteRandomTracks } from '@/services/game/dgsDb'

const logger = createModuleLogger('ApiGameInitRound')
const HANDLER_TIMEOUT_MS = 9000

type CacheValue = {
  expiresAt: number
  response: unknown
}

// Short-lived in-memory cache to avoid repeat engine runs for same seed/targets
const initRoundCache = new Map<string, CacheValue>()

// Add caching to reduce redundant DGS engine runs for same track
export const revalidate = 30 // 30-second cache

const targetArtistSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1)
})

const requestSchema = z.object({
  playbackState: z.record(z.any()),
  roundNumber: z.number().int().min(1).optional(), // No max limit - continuous play
  turnNumber: z.number().int().min(1).optional(),
  currentPlayerId: z.enum(['player1', 'player2']).optional(),
  playerTargets: z
    .object({
      player1: targetArtistSchema.nullable().optional(),
      player2: targetArtistSchema.nullable().optional()
    })
    .partial()
    .optional(),
  playerGravities: z
    .object({
      player1: z.number().optional(),
      player2: z.number().optional()
    })
    .optional(),
  playedTrackIds: z.array(z.string()).optional(),
  lastSelection: z
    .object({
      trackId: z.string(),
      playerId: z.enum(['player1', 'player2']),
      previousTrackId: z.string().nullable().optional(),
      selectionCategory: z.enum(['closer', 'neutral', 'further']).optional()
    })
    .nullable()
    .optional()
})

/**
 * POST /api/game/init-round
 * Server-side endpoint to initialize a game round
 * Returns target artists and game option tracks based on the current playing track
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const handlerStart = Date.now()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await request.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      logger(
        'WARN',
        'Invalid request payload for game init round',
        'validation'
      )
      return NextResponse.json(
        { error: 'Invalid request payload', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const playbackState = parsed.data.playbackState as SpotifyPlaybackState

    if (!playbackState) {
      return NextResponse.json(
        { error: 'Playback state is required' },
        { status: 400 }
      )
    }

    // Get admin profile for Spotify API access
    const accessToken = await getAdminToken()

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Failed to get admin credentials for Spotify API' },
        { status: 500 }
      )
    }

    const artistId = getCurrentArtistId(playbackState)
    if (!artistId || artistId.trim() === '') {
      logger('WARN', 'No artist ID found in playback state', 'validation')
      return NextResponse.json(
        { error: 'No primary artist found for the current track' },
        { status: 400 }
      )
    }

    if (!/^[a-zA-Z0-9]+$/.test(artistId)) {
      logger('WARN', `Invalid artist ID format: ${artistId}`, 'validation')
      return NextResponse.json(
        { error: `Invalid artist ID format: ${artistId}` },
        { status: 400 }
      )
    }

    const normalizedTargets = ensureTargets(parsed.data.playerTargets)
    const normalizedGravities = ensureGravities(parsed.data.playerGravities)
    const roundNumber = clampRound(parsed.data.roundNumber)
    const turnNumber = parsed.data.turnNumber ?? 1
    const currentPlayerId = parsed.data.currentPlayerId ?? 'player1'
    const playedTrackIds = parsed.data.playedTrackIds ?? []

    // Log request details for diagnostics
    logger(
      'INFO',
      `Init round request: Round=${roundNumber} Turn=${turnNumber} Track=${playbackState.item?.name} Artist=${playbackState.item?.artists?.[0]?.name} P1Target=${normalizedTargets.player1?.name} P2Target=${normalizedTargets.player2?.name}`,
      'POST'
    )

    const enginePayload: DualGravityRequest = {
      playbackState,
      roundNumber,
      turnNumber,
      currentPlayerId,
      playerTargets: normalizedTargets,
      playerGravities: normalizedGravities,
      playedTrackIds,
      lastSelection: parsed.data.lastSelection ?? null
    }

    const cacheKey = buildCacheKey(
      playbackState.item?.id ?? '',
      normalizedTargets,
      currentPlayerId
    )

    const cached = initRoundCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      logger('INFO', 'Serving init-round from cache', 'cache')
      const resp = NextResponse.json(cached.response)
      resp.headers.set('X-Init-Round-Path', 'cache')
      return resp
    }

    const engineStartTime = Date.now()
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
      setTimeout(() => resolve({ timeout: true }), HANDLER_TIMEOUT_MS - 200)
    })
    const enginePromise = runDualGravityEngine(enginePayload, accessToken).then(
      (res) => ({ res })
    )

    const raced = await Promise.race([enginePromise, timeoutPromise])

    if ('timeout' in raced) {
      const elapsed = Date.now() - handlerStart
      logger(
        'WARN',
        `Init-round timed out at handler guard after ${elapsed}ms`,
        'POST'
      )
      const fallback = await buildTinyFallback(playbackState)
      const fallbackResponse = NextResponse.json(fallback)
      fallbackResponse.headers.set('X-Init-Round-Path', 'fallback')
      fallbackResponse.headers.set('X-Init-Round-Elapsed', String(elapsed))
      fallbackResponse.headers.set('Cache-Control', 'private, max-age=5')
      initRoundCache.set(cacheKey, {
        expiresAt: Date.now() + 5_000,
        response: fallback
      })
      return fallbackResponse
    }

    const engineResponse = raced.res
    const engineDuration = Date.now() - engineStartTime
    logger(
      'INFO',
      `DGS engine completed in ${engineDuration}ms | Options: ${engineResponse.optionTracks.length} | Pool: ${engineResponse.candidatePoolSize}`,
      'POST'
    )

    if (
      !engineResponse.optionTracks ||
      engineResponse.optionTracks.length === 0
    ) {
      logger(
        'WARN',
        'DGS engine returned empty option tracks',
        'engine',
        undefined
      )
      return NextResponse.json(
        {
          error:
            'No related tracks available. Please try again with a different track.'
        },
        { status: 404 }
      )
    }

    // Build playerTargets map from enriched targetArtists (which include genres)
    // The targetArtists array is ordered as [player1, player2] from the DGS engine
    // We'll try both array index and name/ID matching for robustness
    const normalizeName = (name: string): string => name.trim().toLowerCase()

    const enrichedPlayerTargets: PlayerTargetsMap = {
      player1: (() => {
        const player1Target = normalizedTargets.player1
        if (!player1Target?.name) return null

        // First try: use array index (targetArtists[0] should be player1)
        if (engineResponse.targetArtists.length > 0) {
          const indexMatch = engineResponse.targetArtists[0]
          if (indexMatch?.name) {
            const nameMatch =
              normalizeName(indexMatch.name) ===
              normalizeName(player1Target.name)
            const idMatch =
              indexMatch.id &&
              player1Target.id &&
              indexMatch.id === player1Target.id

            if (nameMatch || idMatch) {
              return indexMatch
            }
          }
        }

        // Fallback: search all enriched artists
        const enriched = engineResponse.targetArtists.find((artist) => {
          if (!artist?.name) return false
          const nameMatch =
            normalizeName(artist.name) === normalizeName(player1Target.name)
          const idMatch =
            artist.id && player1Target.id && artist.id === player1Target.id
          return nameMatch || idMatch
        })

        if (enriched) {
          if (!enriched.genre) {
            logger(
              'WARN',
              `[Player1] Found enriched target but no genre: ${enriched.name}`
            )
          }
          return enriched
        }

        logger(
          'WARN',
          `[Player1] No enriched match found for: ${player1Target.name}`
        )
        return normalizedTargets.player1
      })(),
      player2: (() => {
        const player2Target = normalizedTargets.player2
        if (!player2Target?.name) return null

        // First try: use array index (targetArtists[1] should be player2, or [0] if only one exists)
        const indexToTry = engineResponse.targetArtists.length === 2 ? 1 : 0
        if (engineResponse.targetArtists.length > indexToTry) {
          const indexMatch = engineResponse.targetArtists[indexToTry]
          if (indexMatch?.name) {
            const nameMatch =
              normalizeName(indexMatch.name) ===
              normalizeName(player2Target.name)
            const idMatch =
              indexMatch.id &&
              player2Target.id &&
              indexMatch.id === player2Target.id

            if (nameMatch || idMatch) {
              return indexMatch
            }
          }
        }

        // Fallback: search all enriched artists
        const enriched = engineResponse.targetArtists.find((artist) => {
          if (!artist?.name) return false
          const nameMatch =
            normalizeName(artist.name) === normalizeName(player2Target.name)
          const idMatch =
            artist.id && player2Target.id && artist.id === player2Target.id
          return nameMatch || idMatch
        })

        if (enriched) {
          if (!enriched.genre) {
            logger(
              'WARN',
              `[Player2] Found enriched target but no genre: ${enriched.name}`
            )
          }
          return enriched
        }

        logger(
          'WARN',
          `[Player2] No enriched match found for: ${player2Target.name}`
        )
        return normalizedTargets.player2
      })()
    }

    const responseBody = {
      targetArtists: engineResponse.targetArtists,
      optionTracks: engineResponse.optionTracks,
      playerTargets: enrichedPlayerTargets,
      gravities: engineResponse.updatedGravities,
      explorationPhase: engineResponse.explorationPhase,
      ogDrift: engineResponse.ogDrift,
      candidatePoolSize: engineResponse.candidatePoolSize,
      hardConvergenceActive: engineResponse.hardConvergenceActive,
      vicinity: engineResponse.vicinity,
      debugInfo: engineResponse.debugInfo,
      roundNumber,
      turnNumber,
      currentPlayerId
    }

    const response = NextResponse.json(responseBody)
    response.headers.set(
      'X-Init-Round-Elapsed',
      String(Date.now() - handlerStart)
    )
    response.headers.set('X-Init-Round-Path', 'engine')

    // Add cache headers to reduce redundant DGS engine runs
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=30, stale-while-revalidate=60'
    )

    initRoundCache.set(cacheKey, {
      expiresAt: Date.now() + 30_000,
      response: responseBody
    })

    return response
  } catch (error) {
    const errorDetails =
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name
          }
        : { message: String(error) }

    logger(
      'ERROR',
      `Failed to initialize DGS round: ${errorDetails.message}`,
      'handler',
      error instanceof Error ? error : undefined
    )

    if (error instanceof Error && error.stack) {
      logger('ERROR', `Error stack: ${error.stack}`, 'handler')
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Failed to initialize game round'

    return NextResponse.json(
      {
        error: errorMessage,
        details:
          process.env.NODE_ENV === 'development' ? errorDetails : undefined
      },
      { status: 500 }
    )
  }
}

function buildCacheKey(
  seedTrackId: string,
  targets: PlayerTargetsMap,
  currentPlayerId: 'player1' | 'player2'
): string {
  const t1 = targets.player1
  const t2 = targets.player2
  return [
    seedTrackId || 'none',
    currentPlayerId,
    t1?.id ?? t1?.name ?? 'p1-none',
    t2?.id ?? t2?.name ?? 'p2-none'
  ].join('|')
}

async function buildTinyFallback(playbackState: SpotifyPlaybackState): Promise<{
  targetArtists: unknown[]
  optionTracks: unknown[]
  playerTargets: PlayerTargetsMap
  gravities: PlayerGravityMap
  explorationPhase: string
  ogDrift: number
  candidatePoolSize: number
  hardConvergenceActive: boolean
  vicinity: { triggered: boolean; playerId?: 'player1' | 'player2' }
  debugInfo?: unknown
  roundNumber?: number
  turnNumber?: number
  currentPlayerId?: 'player1' | 'player2'
}> {
  const seedTrackId = playbackState.item?.id ?? 'unknown'
  logger(
    'WARN',
    `Returning tiny fallback for seed track ${seedTrackId}`,
    'fallback'
  )

  // Try a very small DB fetch for a few random tracks; timeout quickly
  const excludeIds = new Set<string>([seedTrackId].filter(Boolean))
  const fetchPromise = fetchAbsoluteRandomTracks(8, excludeIds)
  const timedResult = await Promise.race([
    fetchPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 300))
  ])
  const optionTracks =
    timedResult?.slice(0, 6).map((track) => ({
      track,
      source: 'fallback',
      metrics: {},
      vicinity: { triggered: false }
    })) ?? []

  return {
    targetArtists: [],
    optionTracks,
    playerTargets: { player1: null, player2: null },
    gravities: {
      player1: DEFAULT_PLAYER_GRAVITY,
      player2: DEFAULT_PLAYER_GRAVITY
    },
    explorationPhase: 'low',
    ogDrift: 0,
    candidatePoolSize: 0,
    hardConvergenceActive: false,
    vicinity: { triggered: false },
    debugInfo: { fallback: true, reason: 'handler_timeout' }
  }
}

function ensureTargets(incoming?: Partial<PlayerTargetsMap>): PlayerTargetsMap {
  // Target artists are now managed by the UI via database
  // If not provided, leave as null - they will be set by players in the UI
  const normalized: PlayerTargetsMap = {
    player1: incoming?.player1 ?? null,
    player2: incoming?.player2 ?? null
  }

  return normalized
}

function ensureGravities(
  incoming?: Partial<PlayerGravityMap>
): PlayerGravityMap {
  return {
    player1: incoming?.player1 ?? DEFAULT_PLAYER_GRAVITY,
    player2: incoming?.player2 ?? DEFAULT_PLAYER_GRAVITY
  }
}

function clampRound(round?: number): number {
  if (!round || Number.isNaN(round)) {
    return 1
  }
  // No max limit - allow continuous play
  return Math.max(round, 1)
}
