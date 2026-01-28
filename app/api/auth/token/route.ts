import { NextResponse } from 'next/server'
import { createModuleLogger } from '@/shared/utils/logger'
import { TokenService } from '@/services/tokenService'
import { createClient } from '@/utils/supabase/server'

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
    const supabase = createClient()
    const tokenService = new TokenService(supabase)

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
