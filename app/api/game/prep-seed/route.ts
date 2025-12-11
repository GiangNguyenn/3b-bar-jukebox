import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import {
  type DualGravityRequest,
  DEFAULT_PLAYER_GRAVITY,
  type PlayerGravityMap,
  type PlayerTargetsMap
} from '@/services/game/dgsTypes'
import { getCurrentArtistId } from '@/services/gameService'
import { runDualGravityEngine } from '@/services/game/dgsEngine'
import { getAdminToken } from '@/services/game/adminAuth'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  createPrepJob,
  createPrepJobKey,
  findReadyJobByKey,
  getPrepJob,
  markPrepFailed,
  markPrepReady
} from '@/services/game/prepCache'

const logger = createModuleLogger('ApiGamePrepSeed')
const PREP_TTL_MS = 60_000
const PREP_TIMEOUT_MS = 10000

const targetArtistSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1)
})

const requestSchema = z.object({
  playbackState: z.record(z.any()),
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
  roundNumber: z.number().int().min(1).optional(),
  turnNumber: z.number().int().min(1).optional()
})

export function GET(request: NextRequest): NextResponse {
  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }
  const job = getPrepJob<unknown>(jobId)
  if (!job) {
    return NextResponse.json({ status: 'missing' }, { status: 404 })
  }
  logger(
    'INFO',
    `Status lookup jobId=${job.id} status=${job.status} expiresAt=${job.expiresAt}`,
    'status'
  )
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    expiresAt: job.expiresAt,
    payload: job.status === 'ready' ? job.payload : undefined
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as unknown
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request payload', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const playbackState = parsed.data.playbackState as SpotifyPlaybackState
    if (!playbackState?.item?.id) {
      return NextResponse.json(
        { error: 'Playback state with track is required' },
        { status: 400 }
      )
    }

    const accessToken = await getAdminToken()
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Failed to get admin credentials for Spotify API' },
        { status: 500 }
      )
    }

    const artistId = getCurrentArtistId(playbackState)
    if (!artistId || !/^[a-zA-Z0-9]+$/.test(artistId)) {
      return NextResponse.json(
        { error: 'Invalid or missing artist ID' },
        { status: 400 }
      )
    }

    const normalizedTargets = ensureTargets(parsed.data.playerTargets)
    const normalizedGravities = ensureGravities(parsed.data.playerGravities)
    const roundNumber = clampRound(parsed.data.roundNumber)
    const turnNumber = parsed.data.turnNumber ?? 1
    const currentPlayerId = parsed.data.currentPlayerId ?? 'player1'
    const playedTrackIds = parsed.data.playedTrackIds ?? []

    const cacheKey = createPrepJobKey([
      playbackState.item.id,
      normalizedTargets.player1?.id ?? normalizedTargets.player1?.name ?? 'p1',
      normalizedTargets.player2?.id ?? normalizedTargets.player2?.name ?? 'p2',
      currentPlayerId
    ])
    const ready = findReadyJobByKey(cacheKey)
    if (ready) {
      logger(
        'INFO',
        `Prep cache hit key=${cacheKey} jobId=${ready.id} expiresAt=${ready.expiresAt}`,
        'prep'
      )
      return NextResponse.json({
        jobId: ready.id,
        status: 'ready',
        expiresAt: ready.expiresAt,
        payload: ready.payload
      })
    }

    const job = createPrepJob(cacheKey, PREP_TTL_MS)
    logger(
      'INFO',
      `Prep job created jobId=${job.id} key=${cacheKey} seed=${playbackState.item.id}`,
      'prep'
    )

    const enginePayload: DualGravityRequest = {
      playbackState,
      roundNumber,
      turnNumber,
      currentPlayerId,
      playerTargets: normalizedTargets,
      playerGravities: normalizedGravities,
      playedTrackIds,
      lastSelection: null
    }

    const prepStart = Date.now()
    const prepPromise = runDualGravityEngine(enginePayload, accessToken)
    const result = await Promise.race([
      prepPromise.then((res) => ({ res })),
      new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), PREP_TIMEOUT_MS)
      )
    ])

    if ('timeout' in result) {
      logger(
        'WARN',
        `Prep-seed timed out at ${PREP_TIMEOUT_MS}ms for track ${playbackState.item.id} jobId=${job.id} key=${cacheKey}`,
        'prep'
      )
      // Allow background completion to mark ready when it finishes
      void prepPromise
        .then((res) => markPrepReady(job.id, res, PREP_TTL_MS))
        .catch((err) => {
          markPrepFailed(
            job.id,
            err instanceof Error ? err.message : String(err)
          )
          logger(
            'WARN',
            `Prep background failed jobId=${job.id} key=${cacheKey} error=${err instanceof Error ? err.message : String(err)}`,
            'prep'
          )
        })
      return NextResponse.json(
        { jobId: job.id, status: 'warming', expiresAt: job.expiresAt },
        { status: 202 }
      )
    }

    const prepElapsed = Date.now() - prepStart
    const readyJob = markPrepReady(job.id, result.res, PREP_TTL_MS)
    logger(
      'INFO',
      `Prep complete jobId=${job.id} key=${cacheKey} elapsed=${prepElapsed}ms expiresAt=${readyJob?.expiresAt}`,
      'prep'
    )
    return NextResponse.json(
      {
        jobId: readyJob?.id ?? job.id,
        status: 'ready',
        expiresAt: readyJob?.expiresAt ?? job.expiresAt,
        payload: readyJob?.payload ?? result.res
      },
      { status: 200 }
    )
  } catch (error) {
    logger(
      'ERROR',
      'Exception in prep-seed',
      'handler',
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to prepare seed' },
      { status: 500 }
    )
  }
}

function ensureTargets(incoming?: Partial<PlayerTargetsMap>): PlayerTargetsMap {
  return {
    player1: incoming?.player1 ?? null,
    player2: incoming?.player2 ?? null
  }
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
  if (!round || Number.isNaN(round)) return 1
  return Math.max(round, 1)
}
