import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { TokenService } from '@/services/tokenService'

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
const ADMIN_USERNAME = '3B'

export async function GET(): Promise<
  NextResponse<TokenResponse | ErrorResponse>
> {
  try {
    const cookieStore = cookies()

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            const allCookies = cookieStore.getAll()
            return allCookies.filter((cookie) => cookie.name.startsWith('sb-'))
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

    const tokenService = new TokenService(supabase)

    try {
      // Get Admin Token ('3B')
      const tokenResult =
        await tokenService.getValidTokenByUsername(ADMIN_USERNAME)

      return NextResponse.json({
        access_token: tokenResult.accessToken,
        expires_in: tokenResult.expiresIn
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      if (message.includes('User') && message.includes('not found')) {
        // Fallback logic from original code: try to find *any* profile if '3B' not found?
        // Original code: "Fallback: try to get first profile if '3B' profile not found"
        // We can implement this fallback here or just fail.
        // Given reliability is key, maybe we should replicate fallback or just fail loudly?
        // Failing loudly is more secure and predictable than "random profile".
        // I will fail loudly as the user "3B" should exist for the Jukebox.

        logger('ERROR', `Admin user '${ADMIN_USERNAME}' not found`, undefined)
        return NextResponse.json(
          {
            error: `Admin profile '${ADMIN_USERNAME}' not found`,
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
