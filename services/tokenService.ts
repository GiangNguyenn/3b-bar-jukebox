import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

const logger = createModuleLogger('TokenService')

// Configuration
const TOKEN_EXPIRY_BUFFER_SECONDS = 300 // 5 minutes buffer
const MAX_RACE_RETRIES = 3

export interface TokenResult {
  accessToken: string
  expiresIn: number
}

export class TokenService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Gets a valid access token for a specific user ID.
   * Handles expiration checks (with buffer) and refreshing if needed.
   */
  async getValidToken(userId: string): Promise<TokenResult> {
    return this.resolveToken(userId)
  }

  /**
   * Gets a valid access token for a specific username (display_name).
   */
  async getValidTokenByUsername(username: string): Promise<TokenResult> {
    // 1. Get User ID from username
    const { data: userProfile, error } = await this.supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', username)
      .single()

    if (error || !userProfile) {
      logger('ERROR', `User not found: ${username}`, undefined, error)
      throw new Error(`User '${username}' not found`)
    }

    return this.resolveToken(userProfile.id)
  }

  /**
   * Internal method to resolve token with retries for race conditions.
   */
  private async resolveToken(
    userId: string,
    retryCount = 0
  ): Promise<TokenResult> {
    if (retryCount >= MAX_RACE_RETRIES) {
      throw new Error('Max retries exceeded while resolving token')
    }

    // 1. Fetch current token data
    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select(
        'spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .eq('id', userId)
      .single()

    if (error || !profile) {
      throw new Error('Profile not found or database error')
    }

    const {
      spotify_access_token: accessToken,
      spotify_refresh_token: refreshToken,
      spotify_token_expires_at: expiresAt
    } = profile

    if (!accessToken || !refreshToken || !expiresAt) {
      throw new Error('Missing Spotify credentials in profile')
    }

    // 2. Check Expiration with Buffer
    const now = Math.floor(Date.now() / 1000)
    const expiresWithBuffer = expiresAt - TOKEN_EXPIRY_BUFFER_SECONDS

    if (expiresWithBuffer > now) {
      // Token is valid
      return {
        accessToken,
        expiresIn: expiresAt - now
      }
    }

    // 3. Token Expired (or close to), Refresh it
    logger(
      'INFO',
      `Token expiring soon or expired for ${userId}, refreshing...`
    )
    return this.performRefresh(userId, refreshToken, retryCount)
  }

  private async performRefresh(
    userId: string,
    currentRefreshToken: string,
    retryCount: number
  ): Promise<TokenResult> {
    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      throw new Error('Missing Server Configuration')
    }

    // Call Spotify API
    const refreshResult = await refreshTokenWithRetry(
      currentRefreshToken,
      SPOTIFY_CLIENT_ID,
      SPOTIFY_CLIENT_SECRET
    )

    if (!refreshResult.success || !refreshResult.accessToken) {
      if (refreshResult.error?.isRecoverable) {
        throw new Error(`Token refresh failed: ${refreshResult.error?.message}`)
      }
      // If invalid grant, we can't do anything automated
      throw new Error(
        `Critical Token Error: ${refreshResult.error?.message || 'Unknown invalid grant'}`
      )
    }

    // Update Database with OCC
    const updateResult = await updateTokenInDatabase(this.supabase, userId, {
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken,
      expiresIn: refreshResult.expiresIn,
      currentRefreshToken: currentRefreshToken
    })

    if (!updateResult.success) {
      // If race condition, RETRY the whole flows
      // The other process probably updated the token, so next read will get valid token
      if (updateResult.error?.code === 'RACE_CONDITION') {
        logger('WARN', `Race condition detected for ${userId}, retrying...`)
        // Wait a small random jitter to prevent thundering herd
        await new Promise((resolve) =>
          setTimeout(resolve, 100 + Math.random() * 200)
        )
        return this.resolveToken(userId, retryCount + 1)
      }

      throw new Error(`DB Update Failed: ${updateResult.error?.message}`)
    }

    return {
      accessToken: refreshResult.accessToken,
      expiresIn: refreshResult.expiresIn ?? 3600
    }
  }
}
