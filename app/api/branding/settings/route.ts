import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { BrandingService } from '@/services/brandingService'
import { createModuleLogger } from '@/shared/utils/logger'
import { validateBrandingSettingsPartial } from '@/app/[username]/admin/components/branding/validation/branding-validation'

type BrandingSettings = Database['public']['Tables']['branding_settings']['Row']

const logger = createModuleLogger('API Branding Settings')

export async function GET(): Promise<NextResponse> {
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

    const brandingService = new BrandingService()
    const settings = (await brandingService.getBrandingSettings(
      user.id
    )) as BrandingSettings | null

    return NextResponse.json(settings)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger(
      'ERROR',
      `Error in GET branding settings: ${errorMessage}`,
      'API Branding Settings',
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
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

    const body = (await request.json()) as Record<string, unknown>

    // Validate the input data
    const validatedData = validateBrandingSettingsPartial(body)

    const brandingService = new BrandingService()
    const settings = (await brandingService.upsertBrandingSettings(
      user.id,
      validatedData
    )) as BrandingSettings

    return NextResponse.json(settings)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger(
      'ERROR',
      `Error in PUT branding settings: ${errorMessage}`,
      'API Branding Settings',
      error instanceof Error ? error : undefined
    )

    if (error instanceof Error && error.message.includes('Invalid')) {
      return NextResponse.json(
        { error: 'Invalid branding settings data' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
