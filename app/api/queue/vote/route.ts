import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseWithType } from '@/shared/types/utils'
import { queryWithRetry } from '@/lib/supabaseQuery'

const voteSchema = z.object({
  queueId: z.string().uuid(),
  voteDirection: z.enum(['up', 'down'])
})

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        }
      }
    }
  )

  try {
    const body = (await request.json()) as unknown
    const parsed: z.infer<typeof voteSchema> = parseWithType(voteSchema, body)
    const { queueId, voteDirection } = parsed
    const voteValue = voteDirection === 'up' ? 1 : -1

    // First get the current votes
    const fetchResult = await queryWithRetry<{
      votes: number
    }>(
      supabase.from('jukebox_queue').select('votes').eq('id', queueId).single(),
      undefined,
      `Fetch queue item for voting: ${queueId}`
    )

    const currentQueue = fetchResult.data
    const fetchError = fetchResult.error

    if (fetchError ?? !currentQueue) {
      return NextResponse.json(
        { error: 'Queue item not found' },
        { status: 404 }
      )
    }

    // Update the votes column with the new value
    const updateResult = await queryWithRetry(
      supabase
        .from('jukebox_queue')
        .update({ votes: currentQueue.votes + voteValue })
        .eq('id', queueId),
      undefined,
      `Update votes for queueId: ${queueId}`
    )

    const updateError = updateResult.error

    if (updateError) {
      const errorMessage =
        typeof updateError === 'object' &&
        updateError !== null &&
        'message' in updateError
          ? String(updateError.message)
          : 'Unknown error'
      return NextResponse.json(
        { error: 'Error updating votes', details: errorMessage },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: 'Vote recorded' }, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
}
