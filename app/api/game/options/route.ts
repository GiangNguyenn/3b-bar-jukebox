import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import type { PlayerTargetsMap } from '@/services/game/dgsTypes'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  createPrepJobKey,
  findReadyJobByKey,
  getPrepJob
} from '@/services/game/prepCache'

const logger = createModuleLogger('ApiGameOptions')

const requestSchema = z.object({
  playbackState: z.record(z.any()),
  currentPlayerId: z.enum(['player1', 'player2']).optional(),
  playerTargets: z
    .object({
      player1: z
        .object({
          id: z.string().optional(),
          name: z.string().optional()
        })
        .nullable()
        .optional(),
      player2: z
        .object({
          id: z.string().optional(),
          name: z.string().optional()
        })
        .nullable()
        .optional()
    })
    .partial()
    .optional(),
  jobId: z.string().optional(),
  payload: z.any().optional()
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as unknown
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request payload', details: parsed.error.format() },
      { status: 400 }
    )
  }

  const playbackState = parsed.data.playbackState as SpotifyPlaybackState
  const seedId = playbackState?.item?.id
  if (!seedId) {
    return NextResponse.json(
      { error: 'Playback state with track is required' },
      { status: 400 }
    )
  }

  const currentPlayerId = parsed.data.currentPlayerId ?? 'player1'
  const targets = ensureTargets(parsed.data.playerTargets)
  const cacheKey = createPrepJobKey([
    seedId,
    targets.player1?.id ?? targets.player1?.name ?? 'p1',
    targets.player2?.id ?? targets.player2?.name ?? 'p2',
    currentPlayerId
  ])

  if (parsed.data.payload) {
    const response = NextResponse.json(parsed.data.payload)
    response.headers.set('X-Init-Path', 'options-direct')
    return response
  }

  const job =
    (parsed.data.jobId ? getPrepJob(parsed.data.jobId) : undefined) ??
    findReadyJobByKey(cacheKey)

  if (!job) {
    logger('INFO', `Options warming: no job found key=${cacheKey}`, 'options')
    return NextResponse.json(
      { status: 'warming', message: 'No prep job found' },
      { status: 202 }
    )
  }

  if (job.status !== 'ready' || !job.payload) {
    logger(
      'INFO',
      `Options warming: job not ready jobId=${job.id} status=${job.status} expiresAt=${job.expiresAt}`,
      'options'
    )
    return NextResponse.json(
      { status: 'warming', jobId: job.id, expiresAt: job.expiresAt },
      { status: 202 }
    )
  }

  logger('INFO', `Options ready jobId=${job.id} key=${cacheKey}`, 'options')
  const response = NextResponse.json(job.payload)
  response.headers.set('X-Init-Path', 'options-cache')
  response.headers.set('X-Init-Job', job.id)
  return response
}

function ensureTargets(incoming?: {
  player1?: { id?: string; name?: string } | null
  player2?: { id?: string; name?: string } | null
}): PlayerTargetsMap {
  const normalize = (val?: { id?: string; name?: string } | null) => {
    if (!val?.name && !val?.id) return null
    return { id: val.id, name: val.name ?? 'Unknown' }
  }
  return {
    player1: normalize(incoming?.player1),
    player2: normalize(incoming?.player2)
  }
}
