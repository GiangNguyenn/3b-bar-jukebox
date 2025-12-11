import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyGravityUpdates } from '@/services/game/dgsEngine'
import type { DualGravityRequest } from '@/services/game/dgsTypes'
import { createModuleLogger } from '@/shared/utils/logger'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

const logger = createModuleLogger('ApiGameInfluence')

const requestSchema = z.object({
  playerGravities: z.object({
    player1: z.number(),
    player2: z.number()
  }),
  lastSelection: z.object({
    trackId: z.string(),
    playerId: z.enum(['player1', 'player2']),
    selectionCategory: z.enum(['closer', 'neutral', 'further']).optional(),
    previousTrackId: z.string().nullable().optional()
  })
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await request.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      logger('WARN', 'Invalid request', 'validation')
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const { playerGravities, lastSelection } = parsed.data

    // Construct request object for DGS engine
    // We only provide fields required by applyGravityUpdates
    const engineRequest = {
      playerGravities,
      lastSelection,
      // Mock unused fields to satisfy type requirements
      playbackState: {} as SpotifyPlaybackState,
      roundNumber: 1,
      turnNumber: 1,
      currentPlayerId: lastSelection.playerId, // irrelevant for gravity update
      playerTargets: { player1: null, player2: null },
      playedTrackIds: []
    } as DualGravityRequest

    const updatedGravities = applyGravityUpdates({ request: engineRequest })

    logger(
      'INFO',
      `Influence update: ${lastSelection.playerId} selected ${lastSelection.selectionCategory ?? 'unknown'} -> P1:${updatedGravities.player1.toFixed(3)} P2:${updatedGravities.player2.toFixed(3)}`,
      'POST'
    )

    return NextResponse.json({ gravities: updatedGravities })
  } catch (error) {
    logger(
      'ERROR',
      'Failed to update influence',
      'handler',
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
