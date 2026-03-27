import { NextRequest, NextResponse } from 'next/server'
import type { PostgrestError } from '@supabase/supabase-js'
import { scoreSubmitRequestSchema } from '@/shared/validations/trivia'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('ApiTriviaScores')

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = scoreSubmitRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { profile_id, session_id, player_name } = parsed.data

  try {
    // We increment the score by 1 if it exists, or insert with score 1 if it doesn't.
    // We can do this atomically with a postgres on_conflict upsert or by calling an RPC, or querying then upserting.
    // For simplicity, fetch the row, increment locally, and upsert. Real-time subscriptions will catch the change.
    const { data: existingScore, error: fetchError } = (await supabaseAdmin
      .from('trivia_scores')
      .select('score, first_score_at')
      .eq('profile_id', profile_id)
      .eq('session_id', session_id)
      .single()) as {
      data: { score: number; first_score_at: string } | null
      error: PostgrestError | null
    }

    if (fetchError && fetchError.code !== 'PGRST116') {
      logger('ERROR', 'Error fetching existing score', fetchError.message)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    const currentScore = existingScore?.score ?? 0
    const newScore = currentScore + 1
    const firstScoreAt =
      existingScore?.first_score_at ?? new Date().toISOString()

    const { error: upsertError } = await supabaseAdmin
      .from('trivia_scores')
      .upsert(
        {
          profile_id,
          session_id,
          player_name,
          score: newScore,
          first_score_at: firstScoreAt,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'profile_id, session_id'
        }
      )

    if (upsertError) {
      logger('ERROR', 'Error upserting score', upsertError.message)
      return NextResponse.json(
        { error: 'Database error on upsert' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, new_score: newScore })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    logger('ERROR', 'Caught exception in /api/trivia/scores:', errorMessage)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
