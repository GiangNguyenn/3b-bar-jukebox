import { getAppAccessToken } from '@/services/spotify/auth'
import { getBaseUrl } from '@/shared/utils/domain'
import { TokenError } from '@/shared/types/token'
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
  private onRefreshCallbacks: Array<() => void> = []

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

  /**
   * Register a callback to be invoked after a successful token refresh.
   * Useful for clearing error cooldowns in dependent systems (e.g. queueManager).
   * Returns an unsubscribe function.
   */
  public onRefresh(callback: () => void): () => void {
    this.onRefreshCallbacks.push(callback)
    return () => {
      const index = this.onRefreshCallbacks.indexOf(callback)
      if (index !== -1) {
        this.onRefreshCallbacks.splice(index, 1)
      }
    }
  }

  private notifyRefreshSuccess(): void {
    for (const cb of this.onRefreshCallbacks) {
      try {
        cb()
      } catch {
        // Don't let callback errors break token flow
      }
    }
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

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout: number = 10000
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () =>
        controller.abort(`Token fetch timeout after ${timeout}ms for ${url}`),
      timeout
    )
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Fetch with timeout and automatic retry for transient network failures.
   * Used for token refresh calls where reliability is critical.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    timeout: number = 15000,
    maxRetries: number = 2
  ): Promise<Response> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetchWithTimeout(url, options, timeout)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry if it's not a network/timeout error
        const isRetryable =
          lastError.name === 'AbortError' ||
          lastError.message.includes('fetch') ||
          lastError.message.includes('network') ||
          lastError.message.includes('timeout')

        if (!isRetryable || attempt === maxRetries) {
          throw lastError
        }

        // Exponential backoff: 1s, 2s
        const delay = 1000 * Math.pow(2, attempt)
        if (addLog) {
          addLog(
            'WARN',
            `Token fetch attempt ${attempt + 1}/${maxRetries + 1} failed (${lastError.message}), retrying in ${delay}ms`,
            'TokenManager'
          )
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw lastError ?? new Error('Token fetch failed after retries')
  }

  private async refreshToken(): Promise<string> {
    let lastError: Error | null = null
    let lastErrorCode: string | undefined

    // Define token endpoints in priority order
    const endpoints = this.buildTokenEndpoints()

    try {
      for (const endpoint of endpoints) {
        const result = await this.tryTokenEndpoint(endpoint)
        if (result.token) {
          this.tokenCache = { token: result.token, expiry: result.expiry }
          this.notifyRefreshSuccess()
          return result.token
        }
        if (result.error) {
          lastError = result.error
          lastErrorCode = result.errorCode
        }
      }

      // All endpoints failed
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

  /**
   * Build the ordered list of token endpoints to try.
   */
  private buildTokenEndpoints(): Array<{
    url: string
    options: RequestInit
    label: string
    parseResponse: (data: unknown) => { token: string; expiry: number } | null
  }> {
    const endpoints: Array<{
      url: string
      options: RequestInit
      label: string
      parseResponse: (data: unknown) => { token: string; expiry: number } | null
    }> = [
      {
        url: `${this.config.baseUrl}/api/token`,
        options: {
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }
        },
        label: 'user',
        parseResponse: (data) => {
          const result = safeParseTokenResponse(data)
          if (!result.success) return null
          return {
            token: result.data.access_token,
            expiry: Date.now() + result.data.expires_in * 1000
          }
        }
      },
      {
        url: `${this.config.baseUrl}/api/auth/token`,
        options: { cache: 'no-store' },
        label: 'admin',
        parseResponse: (data) => {
          const result = safeParseTokenResponse(data)
          if (!result.success) return null
          return {
            token: result.data.access_token,
            expiry: Date.now() + result.data.expires_in * 1000
          }
        }
      }
    ]

    if (this.config.publicTokenUsername) {
      endpoints.push({
        url: `${this.config.baseUrl}/api/token/${encodeURIComponent(this.config.publicTokenUsername)}`,
        options: { cache: 'no-store' },
        label: 'public',
        parseResponse: (data) => {
          const result = safeParseTokenHealthResponse(data)
          if (!result.success) return null
          const accessToken = result.data.access_token
          if (!accessToken) return null

          let expiresAtMs: number
          if (result.data.expires_in) {
            expiresAtMs = Date.now() + result.data.expires_in * 1000
          } else if (result.data.expiresIn) {
            expiresAtMs = Date.now() + result.data.expiresIn * 1000
          } else {
            expiresAtMs = Date.now() + DEFAULT_TOKEN_EXPIRY_SECONDS * 1000
          }
          return { token: accessToken, expiry: expiresAtMs }
        }
      })
    }

    return endpoints
  }

  /**
   * Attempt a single token endpoint. Returns the token + expiry on success,
   * or error details on failure.
   */
  private async tryTokenEndpoint(endpoint: {
    url: string
    options: RequestInit
    label: string
    parseResponse: (data: unknown) => { token: string; expiry: number } | null
  }): Promise<{
    token?: string
    expiry: number
    error?: Error
    errorCode?: string
  }> {
    try {
      const response = await this.fetchWithRetry(endpoint.url, endpoint.options)

      if (response.ok) {
        try {
          const dataRaw = await response.json()
          const parsed = endpoint.parseResponse(dataRaw)
          if (parsed) {
            return { token: parsed.token, expiry: parsed.expiry }
          }
        } catch (parseError) {
          this.handleParseError(
            parseError,
            endpoint.label as 'user' | 'admin' | 'public'
          )
        }
        return { expiry: 0 }
      }

      // Non-OK response — try to extract error details
      try {
        const errorDataRaw = await response.json()
        const errorResult = this.parseErrorResponse(
          errorDataRaw,
          endpoint.label
        )
        if (errorResult.error) {
          return {
            expiry: 0,
            error: errorResult.error,
            errorCode: errorResult.code
          }
        }
      } catch {
        // Ignore JSON parse failures on error responses
      }
      return { expiry: 0 }
    } catch (fetchError) {
      // Network/timeout errors — log and continue to next endpoint
      if (addLog) {
        addLog(
          'WARN',
          `Failed to fetch ${endpoint.label} token endpoint`,
          'TokenManager',
          fetchError instanceof Error ? fetchError : undefined
        )
      }
      return { expiry: 0 }
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
