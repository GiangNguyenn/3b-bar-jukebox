import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { updateWithRetry } from '@/lib/supabaseQuery'
import { createModuleLogger } from '@/shared/utils/logger'
import type { TokenRefreshResult } from './tokenRecovery'

const logger = createModuleLogger('TokenDatabaseUpdate')

interface TokenUpdateData {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  currentRefreshToken: string
}

interface TokenUpdateResult {
  success: boolean
  error?: {
    code: string
    message: string
    isRecoverable: boolean
  }
}

/**
 * Updates token in database with retry logic
 * This is critical - if database update fails, we should not return the token to the client
 * as it creates inconsistency between what's stored and what's returned
 */
export async function updateTokenInDatabase(
  supabase: SupabaseClient<Database>,
  profileId: string,
  tokenData: TokenUpdateData
): Promise<TokenUpdateResult> {
  // Calculate expires_at - use expiresIn if available, otherwise default to 1 hour
  const newExpiresAt =
    tokenData.expiresIn !== undefined
      ? Math.floor(Date.now() / 1000) + tokenData.expiresIn
      : Math.floor(Date.now() / 1000) + 3600 // Default to 1 hour if expiresIn is not provided

  const updateData = {
    spotify_access_token: tokenData.accessToken,
    spotify_refresh_token:
      tokenData.refreshToken ?? tokenData.currentRefreshToken,
    spotify_token_expires_at: newExpiresAt
  }

  const result = await updateWithRetry(
    supabase,
    'profiles',
    async (builder) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await builder.update(updateData as any).eq('id', profileId)
    },
    undefined, // Use default retry config
    `Update token for profile ${profileId}`
  )

  if (result.error) {
    logger(
      'ERROR',
      `Failed to update token in database after retries: ${JSON.stringify(result.error)}`,
      undefined,
      result.error instanceof Error ? result.error : undefined
    )

    // Determine if error is recoverable
    const isRecoverable =
      typeof result.error === 'object' &&
      result.error !== null &&
      'code' in result.error &&
      typeof result.error.code === 'string' &&
      (result.error.code.startsWith('PGRST3') || // Connection errors
        result.error.code.startsWith('ECONN') ||
        result.error.code.startsWith('ETIMEDOUT'))

    return {
      success: false,
      error: {
        code: 'DATABASE_UPDATE_ERROR',
        message:
          result.error instanceof Error
            ? result.error.message
            : 'Failed to update token in database',
        isRecoverable
      }
    }
  }

  logger(
    'INFO',
    `Successfully updated token in database for profile ${profileId}`
  )
  return { success: true }
}
