import { getAppAccessToken } from '@/services/spotify/auth'
import { getBaseUrl } from '@/shared/utils/domain'
import type {
  TokenResponse,
  TokenResponseWithExpiry,
  TokenError
} from '@/shared/types/token'
import {
  safeParseTokenResponse,
  safeParseTokenHealthResponse,
  safeParseTokenErrorResponse
} from '@/shared/validations/tokenSchemas'
import { DEFAULT_TOKEN_EXPIRY_SECONDS } from '@/shared/constants/token'

// Add logging context
let addLog: (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

// Function to set the logging function
export function setTokenManagerLogger(logger: typeof addLog) {
  addLog = logger
}

/**
 * @deprecated This interface is legacy and should not be used in new code.
 * Use types from @/shared/types/token.ts instead.
 * This interface will be removed in a future version.
 */
export interface TokenInfo {
  lastRefresh: number
  expiresIn: number
  scope: string
  type: string
  lastActualRefresh: number
  expiryTime: number
}

interface TokenCache {
  token: string | null
  expiry: number
}

interface TokenManagerConfig {
  baseUrl: string
  refreshThreshold?: number // Time in seconds before expiry to refresh token
  publicTokenUsername?: string // Username for public token fallback endpoint
}

class TokenManager {
  private static instance: TokenManager
  private tokenCache: TokenCache = {
    token: null,
    expiry: 0
  }
  private config: TokenManagerConfig
  private refreshPromise: Promise<string> | null = null
  private refreshInProgress = false

  private constructor(config: TokenManagerConfig) {
    this.config = {
      refreshThreshold: 300, // Default to 5 minutes
      ...config
    }
  }

  public static getInstance(config: TokenManagerConfig): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager(config)
    }
    return TokenManager.instance
  }

  public async getToken(): Promise<string> {
    const now = Date.now()

    // If we have a valid cached token, return it
    if (this.tokenCache.token && now < this.tokenCache.expiry) {
      return this.tokenCache.token
    }

    // If we're already refreshing, await the existing promise
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    // Start a new refresh
    this.refreshInProgress = true
    this.refreshPromise = this.refreshToken()
    try {
      const token = await this.refreshPromise
      return token
    } finally {
      this.refreshPromise = null
      this.refreshInProgress = false
    }
  }

  /**
   * Helper to handle parse errors consistently
   */
  private handleParseError(
    parseError: unknown,
    context: 'user' | 'admin' | 'public'
  ): void {
    if (addLog) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : 'Unknown parse error'
      addLog(
        'WARN',
        `Failed to parse ${context} token response: ${errorMessage}`,
        'TokenManager',
        parseError instanceof Error ? parseError : undefined
      )
    }
  }

  /**
   * Helper to handle error response parsing
   */
  private parseErrorResponse(
    errorDataRaw: unknown,
    endpoint: string
  ): { error: TokenError | null; code: string | undefined } {
    try {
      const errorParseResult = safeParseTokenErrorResponse(errorDataRaw)
      if (errorParseResult.success) {
        const errorCode = errorParseResult.data.code
        const error = new TokenError(
          `${endpoint} token endpoint error: ${errorParseResult.data.error}`,
          errorCode
        )
        return { error, code: errorCode }
      }
    } catch {
      // Ignore parse errors for error responses
      if (addLog) {
        addLog(
          'WARN',
          `Failed to parse ${endpoint} token error response`,
          'TokenManager'
        )
      }
    }
    return { error: null, code: undefined }
  }

  private async refreshToken(): Promise<string> {
    let lastError: Error | null = null
    let lastErrorCode: string | undefined

    try {
      // Try user-specific token first
      const tryUser = await fetch(`${this.config.baseUrl}/api/token`, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }
      })
      if (tryUser.ok) {
        try {
          const dataRaw = await tryUser.json()
          const parseResult = safeParseTokenResponse(dataRaw)
          if (parseResult.success) {
            const data = parseResult.data
            this.tokenCache = {
              token: data.access_token,
              expiry: Date.now() + data.expires_in * 1000
            }
            return data.access_token
          }
        } catch (parseError) {
          this.handleParseError(parseError, 'user')
        }
      } else {
        // Try to parse error response to preserve error code
        const errorDataRaw = await tryUser.json()
        const errorResult = this.parseErrorResponse(errorDataRaw, 'User')
        if (errorResult.error) {
          lastError = errorResult.error
          lastErrorCode = errorResult.code
        }
      }

      // Fallback 1: admin token endpoint
      const tryAdmin = await fetch(`${this.config.baseUrl}/api/auth/token`, {
        cache: 'no-store'
      })
      if (tryAdmin.ok) {
        try {
          const adminDataRaw = await tryAdmin.json()
          const parseResult = safeParseTokenResponse(adminDataRaw)
          if (parseResult.success) {
            const adminData = parseResult.data
            const expiresAtMs = Date.now() + adminData.expires_in * 1000
            this.tokenCache = {
              token: adminData.access_token,
              expiry: expiresAtMs
            }
            return adminData.access_token
          }
        } catch (parseError) {
          this.handleParseError(parseError, 'admin')
        }
      } else {
        // Try to parse error response to preserve error code
        const errorDataRaw = await tryAdmin.json()
        const errorResult = this.parseErrorResponse(errorDataRaw, 'Admin')
        if (errorResult.error) {
          lastError = errorResult.error
          lastErrorCode = errorResult.code
        }
      }

      // Fallback 2: public username token endpoint
      // Only attempt if username is configured
      if (this.config.publicTokenUsername) {
        try {
          const tryPublic = await fetch(
            `${this.config.baseUrl}/api/token/${encodeURIComponent(this.config.publicTokenUsername)}`,
            { cache: 'no-store' }
          )
          if (tryPublic.ok) {
            try {
              const publicDataRaw = await tryPublic.json()
              // Public endpoint may return expires_at instead of expires_in
              const healthParseResult =
                safeParseTokenHealthResponse(publicDataRaw)
              if (healthParseResult.success) {
                const publicData = healthParseResult.data
                const accessToken = publicData.access_token
                if (accessToken) {
                  // Calculate expiry from expires_at if available, otherwise use expires_in
                  let expiresAtMs: number
                  if (publicData.expires_at) {
                    expiresAtMs = publicData.expires_at * 1000
                  } else if (publicData.expires_in) {
                    expiresAtMs = Date.now() + publicData.expires_in * 1000
                  } else if (publicData.expiresIn) {
                    expiresAtMs = Date.now() + publicData.expiresIn * 1000
                  } else {
                    // Default to 1 hour if no expiry info
                    expiresAtMs =
                      Date.now() + DEFAULT_TOKEN_EXPIRY_SECONDS * 1000
                  }
                  this.tokenCache = { token: accessToken, expiry: expiresAtMs }
                  return accessToken
                }
              }
            } catch (parseError) {
              this.handleParseError(parseError, 'public')
            }
          }
        } catch (fetchError) {
          // Silently ignore fetch errors for fallback endpoint
          if (addLog) {
            addLog(
              'WARN',
              `Failed to fetch public token endpoint for username "${this.config.publicTokenUsername}"`,
              'TokenManager',
              fetchError instanceof Error ? fetchError : undefined
            )
          }
        }
      }

      // Preserve error code if we have one from previous attempts
      const errorMessage =
        'Failed to get token from user, admin, or public endpoints.'
      const error = lastError || new TokenError(errorMessage, lastErrorCode)
      if (addLog) {
        addLog('ERROR', errorMessage, 'TokenManager', error)
      }
      throw error
    } catch (error) {
      if (addLog) {
        addLog(
          'ERROR',
          'Error refreshing token',
          'TokenManager',
          error instanceof Error ? error : undefined
        )
      }
      throw error
    }
  }

  public clearCache(): void {
    this.tokenCache = {
      token: null,
      expiry: 0
    }
  }

  public isTokenValid(): boolean {
    const now = Date.now()
    return Boolean(
      this.tokenCache.token &&
        now <
          this.tokenCache.expiry - (this.config.refreshThreshold ?? 0) * 1000
    )
  }

  // Proactive token refresh - returns true if token was refreshed
  public async refreshIfNeeded(): Promise<boolean> {
    const now = Date.now()
    const timeUntilExpiry = this.tokenCache.expiry - now
    const refreshThreshold = (this.config.refreshThreshold ?? 300) * 1000 // 5 minutes in ms

    // If token expires within the refresh threshold, refresh it
    if (timeUntilExpiry <= refreshThreshold) {
      try {
        await this.getToken() // This will refresh the token
        return true
      } catch (error) {
        if (addLog) {
          addLog(
            'ERROR',
            'Proactive token refresh failed',
            'TokenManager',
            error instanceof Error ? error : undefined
          )
        }
        return false
      }
    }

    return false
  }
}

// Export a singleton instance
// publicTokenUsername can be set via environment variable if needed
export const tokenManager = TokenManager.getInstance({
  baseUrl: getBaseUrl(),
  publicTokenUsername: process.env.NEXT_PUBLIC_ADMIN_USERNAME
})

// Export types
export type { TokenManagerConfig }
