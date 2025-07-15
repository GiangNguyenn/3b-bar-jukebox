/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseWithType } from '@/shared/types/utils'

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
    const parsed: z.infer<typeof voteSchema> = parseWithType(voteSchema, body)
    const { queueId, voteDirection } = parsed
    const voteValue = voteDirection === 'up' ? 1 : -1

    // First get the current votes
    const { data: currentQueue, error: fetchError } = await supabase
      .from('jukebox_queue')
      .select('votes')
      .eq('id', queueId)
      .single()

    if (fetchError || !currentQueue) {
      return NextResponse.json(
        { error: 'Queue item not found' },
        { status: 404 }
      )
    }

    // Update the votes column with the new value
    const { error: updateError } = await supabase
      .from('jukebox_queue')
      .update({ votes: currentQueue.votes + voteValue })
      .eq('id', queueId)

    if (updateError) {
      return NextResponse.json(
        { error: 'Error updating votes', details: updateError.message },
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
