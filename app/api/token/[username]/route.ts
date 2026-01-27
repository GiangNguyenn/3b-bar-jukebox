import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { TokenService } from '@/services/tokenService'

const logger = createModuleLogger('API Token')

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

export async function GET(
  request: Request,
  { params }: { params: { username: string } }
): Promise<NextResponse<TokenResponse | ErrorResponse>> {
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
            }
          }
        }
      }
    )

    // 1. Enforce Authentication
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger('WARN', `Unauthenticated access attempt for ${params.username}`)
      return NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          status: 401
        },
        { status: 401 }
      )
    }

    // Optional: Enforce that user can only request their own token?
    // For now, consistent with plan, we just enforce they are a logged-in user at all.
    // Ideally checks if user.id matches the profile of params.username, or if user is admin.

    // 2. Use TokenService to get valid token
    const tokenService = new TokenService(supabase)

    try {
      const tokenResult = await tokenService.getValidTokenByUsername(
        params.username
      )

      // 3. Return ONLY access_token (No refresh_token leakage)
      return NextResponse.json({
        access_token: tokenResult.accessToken,
        expires_in: tokenResult.expiresIn
      })
    } catch (error) {
      // Handle known errors (like user not found)
      const message = error instanceof Error ? error.message : 'Unknown error'

      if (message.includes('User') && message.includes('not found')) {
        return NextResponse.json(
          {
            error: 'User not found',
            code: 'USER_NOT_FOUND',
            status: 404
          },
          { status: 404 }
        )
      }

      throw error // Let the outer catch handle it
    }
  } catch (error) {
    logger('ERROR', 'Error in token endpoint', undefined, error as Error)
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
