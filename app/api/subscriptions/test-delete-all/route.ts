import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createModuleLogger } from '@/shared/utils/logger'
import type { Database } from '@/types/supabase'

const logger = createModuleLogger('TestDeleteAllSubscriptions')

export async function DELETE(): Promise<NextResponse> {
  try {
    logger(
      'INFO',
      '🗑️ Delete all subscriptions endpoint called',
      'TestDeleteAllSubscriptions'
    )

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

    // Get current user
    logger('INFO', '🗑️ Getting current user...', 'TestDeleteAllSubscriptions')
    const result = (await supabase.auth.getUser()) as {
      data: { user: { id: string } | null }
      error: unknown
    }
    const { user } = result.data
    const userError = result.error

    if (userError || !user) {
      logger('ERROR', '🗑️ User not authenticated', 'TestDeleteAllSubscriptions')
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }

    logger(
      'INFO',
      `🗑️ User authenticated: ${user.id}`,
      'TestDeleteAllSubscriptions'
    )

    // Get user's profile
    const profileResult = (await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()) as { data: { id: string } | null; error: unknown }
    const profile = profileResult.data
    const profileError = profileResult.error

    if (profileError || !profile) {
      logger('ERROR', 'Profile not found', 'TestDeleteAllSubscriptions')
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // First, update the profile to remove subscription_id reference
    logger(
      'INFO',
      `🗑️ Updating profile to remove subscription reference for user: ${user.id}`,
      'TestDeleteAllSubscriptions'
    )
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ subscription_id: null })
      .eq('id', user.id)

    if (updateError) {
      logger(
        'ERROR',
        `🗑️ Error updating profile: ${updateError.message}`,
        'TestDeleteAllSubscriptions'
      )
      return NextResponse.json(
        { error: `Failed to update profile: ${updateError.message}` },
        { status: 500 }
      )
    }

    // Now delete all subscriptions for this user
    logger(
      'INFO',
      `🗑️ Deleting subscriptions for user: ${user.id}`,
      'TestDeleteAllSubscriptions'
    )
    const { error: deleteError } = await supabase
      .from('subscriptions')
      .delete()
      .eq('profile_id', user.id)

    if (deleteError) {
      logger(
        'ERROR',
        `🗑️ Error deleting subscriptions: ${deleteError.message}`,
        'TestDeleteAllSubscriptions'
      )
      return NextResponse.json(
        { error: `Failed to delete subscriptions: ${deleteError.message}` },
        { status: 500 }
      )
    }

    logger(
      'INFO',
      `🗑️ Successfully deleted subscriptions for user: ${user.id}`,
      'TestDeleteAllSubscriptions'
    )

    logger(
      'INFO',
      `🗑️ Successfully deleted all subscription data for user: ${user.id}`,
      'TestDeleteAllSubscriptions'
    )

    return NextResponse.json(
      { message: 'All subscription data deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    logger(
      'ERROR',
      'Unexpected error in delete all subscriptions',
      'TestDeleteAllSubscriptions',
      error as Error
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
