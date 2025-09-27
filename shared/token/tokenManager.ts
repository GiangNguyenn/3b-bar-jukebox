import { getAppAccessToken } from '@/services/spotify/auth'
import { getBaseUrl } from '@/shared/utils/domain'

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

// Token types
export interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

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

    // If we're already refreshing, return the existing promise
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    // Prevent multiple simultaneous refreshes
    if (this.refreshInProgress) {
      // Wait for existing refresh to complete
      while (this.refreshInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return this.tokenCache.token || this.refreshToken()
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

  private async refreshToken(): Promise<string> {
    try {
      // Try user-specific token first
      const tryUser = await fetch(`${this.config.baseUrl}/api/token`, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }
      })
      if (tryUser.ok) {
        const data = (await tryUser.json()) as TokenResponse
        if (data?.access_token) {
          this.tokenCache = {
            token: data.access_token,
            expiry: Date.now() + (data.expires_in ?? 0) * 1000
          }
          return data.access_token
        }
      }

      // Fallback 1: admin token endpoint
      const tryAdmin = await fetch(`${this.config.baseUrl}/api/auth/token`, {
        cache: 'no-store'
      })
      if (tryAdmin.ok) {
        const adminData = (await tryAdmin.json()) as {
          access_token: string
          refresh_token?: string
          expires_at?: number
          expires_in?: number
        }
        const accessToken = adminData?.access_token
        const expiresAtMs = adminData?.expires_at
          ? adminData.expires_at * 1000
          : Date.now() + (adminData?.expires_in ?? 0) * 1000
        if (accessToken) {
          this.tokenCache = { token: accessToken, expiry: expiresAtMs }
          return accessToken
        }
      }

      // Fallback 2: public username token (default admin display_name '3B')
      const tryPublic = await fetch(
        `${this.config.baseUrl}/api/token/${encodeURIComponent('3B')}`,
        { cache: 'no-store' }
      )
      if (tryPublic.ok) {
        const publicData = (await tryPublic.json()) as {
          access_token: string
          refresh_token?: string
          expires_at: number
        }
        const accessToken = publicData?.access_token
        const expiresAtMs = publicData?.expires_at * 1000
        if (accessToken && expiresAtMs) {
          this.tokenCache = { token: accessToken, expiry: expiresAtMs }
          return accessToken
        }
      }

      throw new Error('Failed to get token from user, admin, or public endpoints.')
    } catch (error) {
      console.error('[TokenManager] Error refreshing token:', error)
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
export const tokenManager = TokenManager.getInstance({
  baseUrl: getBaseUrl()
})

// Export types
export type { TokenManagerConfig }
