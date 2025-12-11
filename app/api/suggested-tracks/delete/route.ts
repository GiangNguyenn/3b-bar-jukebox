import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Suggested Tracks Delete')

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const cookieStore = cookies()

    const supabase = createServerClient<Database>(
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

    // Get the current user
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      logger('ERROR', `Auth error: ${JSON.stringify(userError)}`)
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get the request body
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await request.json()
    const trackId =
      typeof body?.trackId === 'string' // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        ? (body.trackId as string) // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        : null

    if (!trackId) {
      logger('ERROR', 'No track ID provided')
      return NextResponse.json(
        { error: 'Track ID is required' },
        { status: 400 }
      )
    }

    logger(
      'INFO',
      `Deleting suggested track for user ${user.id}, track ID: ${trackId}`
    )

    // Delete the suggested track for this user
    const { error: deleteError } = await supabase
      .from('suggested_tracks')
      .delete()
      .eq('profile_id', user.id)
      .eq('track_id', trackId)

    if (deleteError) {
      logger(
        'ERROR',
        `Failed to delete suggested track: ${deleteError.message || 'Unknown error'}`
      )
      return NextResponse.json(
        { error: 'Failed to delete suggested track' },
        { status: 500 }
      )
    }

    logger(
      'INFO',
      `Successfully deleted suggested track for user ${user.id}, track ID: ${trackId}`
    )

    return NextResponse.json({
      message: 'Suggested track deleted successfully',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      deletedTrackId: trackId
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
