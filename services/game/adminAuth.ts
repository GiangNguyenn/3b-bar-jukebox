import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { Database } from '@/types/supabase'
import { queryWithRetry } from '@/lib/supabase'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('AdminAuth')

/**
 * Retrieves a valid Spotify access token for the admin user ('3B').
 * Automatically handles token refreshing and database updates.
 */
export async function getAdminToken(): Promise<string | null> {
  const cookieStore = cookies()

  // Create Supabase client with cookie access
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
            // Ignored in server context
          }
        }
      }
    }
  )

  // Fetch admin profile
  const adminResult = await queryWithRetry<{
    id: string
    spotify_access_token: string | null
    spotify_refresh_token: string | null
    spotify_token_expires_at: number | null
  }>(
    supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .ilike('display_name', '3B')
      .single(),
    undefined,
    'Fetch admin profile for Spotify API access'
  )

  const adminProfile = adminResult.data
  const adminError = adminResult.error

  if (adminError || !adminProfile?.spotify_access_token) {
    logger(
      'ERROR',
      'Failed to get admin Spotify credentials',
      'token',
      adminError instanceof Error ? adminError : undefined
    )
    return null
  }

  // Check if token needs refresh
  const tokenExpiresAt = adminProfile.spotify_token_expires_at
  const now = Math.floor(Date.now() / 1000)

  // Refresh if expired or expiring in next 60 seconds
  if (
    tokenExpiresAt &&
    tokenExpiresAt <= now + 60 &&
    adminProfile.spotify_refresh_token
  ) {
    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      logger('ERROR', 'Server configuration error: Missing Client ID/Secret')
      return null
    }

    const refreshResult = await refreshTokenWithRetry(
      adminProfile.spotify_refresh_token,
      SPOTIFY_CLIENT_ID,
      SPOTIFY_CLIENT_SECRET
    )

    if (!refreshResult.success || !refreshResult.accessToken) {
      logger('ERROR', 'Failed to refresh admin token')
      return null
    }

    // Update token in database
    await updateTokenInDatabase(supabase, adminProfile.id, {
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken,
      expiresIn: refreshResult.expiresIn,
      currentRefreshToken: adminProfile.spotify_refresh_token
    })

    return refreshResult.accessToken
  }

  return adminProfile.spotify_access_token
}
