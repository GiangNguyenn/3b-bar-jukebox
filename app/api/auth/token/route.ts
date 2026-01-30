import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createModuleLogger } from '@/shared/utils/logger'
import { TokenService } from '@/services/tokenService'
import { supabaseAdmin } from '@/lib/supabase-admin'

const logger = createModuleLogger('AuthToken')

// Types
interface ErrorResponse {
  error: string
  code: string
  status: number
}

interface TokenResponse {
  access_token: string
  expires_in: number
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Default admin username to look up
const DEFAULT_ID = '3B'

export async function GET(): Promise<
  NextResponse<TokenResponse | ErrorResponse>
> {
  try {
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
            }
          }
        }
      }
    )

    // Enforce Authentication
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger('WARN', 'Unauthenticated access attempt for admin token endpoint')
      return NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          status: 401
        },
        { status: 401 }
      )
    }

    const tokenService = new TokenService(supabaseAdmin)

    // Prefer environment variable, fallback to default '3B'
    const adminUsername = process.env.NEXT_PUBLIC_ADMIN_USERNAME || DEFAULT_ID

    try {
      // Get Admin Token
      const tokenResult =
        await tokenService.getValidTokenByUsername(adminUsername)

      return NextResponse.json({
        access_token: tokenResult.accessToken,
        expires_in: tokenResult.expiresIn
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      if (message.includes('not found')) {
        logger('ERROR', `Admin user '${adminUsername}' not found`, undefined)
        return NextResponse.json(
          {
            error: `Admin profile '${adminUsername}' not found`,
            code: 'ADMIN_NOT_FOUND',
            status: 404
          },
          { status: 404 }
        )
      }

      throw error
    }
  } catch (error) {
    logger(
      'ERROR',
      'Error in auth token endpoint',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
