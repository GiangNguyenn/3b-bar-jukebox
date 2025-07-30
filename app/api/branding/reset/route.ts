import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Branding Reset')

export async function DELETE(): Promise<NextResponse> {
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

    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Delete branding settings (this will cascade to delete the record)
    const { error } = await supabase
      .from('branding_settings')
      .delete()
      .eq('profile_id', user.id)

    if (error) {
      logger('ERROR', `Error deleting branding settings: ${error.message}`)
      return NextResponse.json(
        { error: 'Failed to reset branding settings' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Branding settings reset successfully'
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Error in DELETE branding reset: ${errorMessage}`)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
