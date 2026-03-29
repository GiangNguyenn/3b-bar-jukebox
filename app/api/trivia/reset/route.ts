import { NextRequest, NextResponse } from 'next/server'
import { resetRequestSchema } from '@/shared/validations/trivia'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('ApiTriviaReset')

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = resetRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { profile_id } = parsed.data

  try {
    // 1. Determine winner and reset scores via RPC
    const { data: winnerData, error: rpcError } = await supabaseAdmin.rpc(
      'trivia_determine_winner_and_reset',
      {
        p_profile_id: profile_id
      }
    )

    if (rpcError) {
      logger('ERROR', 'Failed to execute reset RPC', rpcError.message)
      return NextResponse.json(
        { error: 'Database error on reset' },
        { status: 500 }
      )
    }

    const winner = winnerData && winnerData.length > 0 ? winnerData[0] : null

    // 2. Announce winner if one exists via DJ announcements
    if (winner) {
      const announcementText =
        'Congratulations to ' +
        winner.winner_name +
        ' for winning the music trivia hour with ' +
        winner.winner_score +
        ' points!'

      const { error: announceError } = await supabaseAdmin
        .from('dj_announcements')
        .upsert(
          {
            profile_id,
            script_text: announcementText,
            is_active: true
          },
          { onConflict: 'profile_id' }
        )

      if (announceError) {
        // Log but don't fail the reset operation entirely
        logger(
          'ERROR',
          'Failed to insert DJ announcement for winner',
          announceError.message
        )
      }
    }

    return NextResponse.json({
      winner: winner
        ? { player_name: winner.winner_name, score: winner.winner_score }
        : null,
      reset: true
    })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    logger('ERROR', 'Caught exception in /api/trivia/reset:', errorMessage)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
