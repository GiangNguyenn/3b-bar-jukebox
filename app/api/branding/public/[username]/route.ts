import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Public Branding')

export async function GET(
  request: Request,
  { params }: { params: { username: string } }
): Promise<NextResponse> {
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

    const { username } = params

    // Get the profile for the username
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', username)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Get branding settings for this profile
    const { data: brandingSettings, error: brandingError } = await supabase
      .from('branding_settings')
      .select('*')
      .eq('profile_id', profile.id)
      .single()

    if (brandingError && brandingError.code !== 'PGRST116') {
      logger(
        'ERROR',
        `Error fetching branding settings: ${brandingError.message}`,
        'API Public Branding',
        brandingError
      )
      return NextResponse.json(
        { error: 'Failed to fetch branding settings' },
        { status: 500 }
      )
    }

    return NextResponse.json(brandingSettings)
  } catch (error) {
    logger(
      'ERROR',
      `Error in GET public branding: ${error}`,
      'API Public Branding',
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
