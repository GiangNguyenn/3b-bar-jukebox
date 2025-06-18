import { sendApiRequest } from '../api'

// Add logging context
let addLog: (level: 'LOG' | 'INFO' | 'WARN' | 'ERROR', message: string, context?: string, error?: Error) => void

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

    // Start a new refresh
    this.refreshPromise = this.refreshToken()
    try {
      const token = await this.refreshPromise
      return token
    } finally {
      this.refreshPromise = null
    }
  }

  private async refreshToken(): Promise<string> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/token`, {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (addLog) {
          addLog('ERROR', 'Failed to fetch token', 'TokenManager', errorData)
        } else {
          console.error('[TokenManager] Failed to fetch token:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData
          })
        }
        throw new Error(errorData.error || 'Failed to fetch Spotify token')
      }

      const data = (await response.json()) as TokenResponse
      if (!data.access_token) {
        if (addLog) {
          addLog('ERROR', `Invalid token response: ${JSON.stringify(data)}`, 'TokenManager')
        } else {
          console.error('[TokenManager] Invalid token response:', data)
        }
        throw new Error('Invalid token response')
      }

      // Update cache
      this.tokenCache = {
        token: data.access_token,
        expiry: Date.now() + data.expires_in * 1000
      }

      return data.access_token
    } catch (error) {
      if (addLog) {
        addLog('ERROR', 'Error refreshing token', 'TokenManager', error instanceof Error ? error : undefined)
      } else {
        console.error('[TokenManager] Error refreshing token:', error)
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
}

// Export a singleton instance
export const tokenManager = TokenManager.getInstance({
  baseUrl:
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
})

// Export types
export type { TokenManagerConfig }
