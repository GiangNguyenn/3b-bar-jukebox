// Only non-Spotify types should remain in this file.

export interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
  creation_time: number
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

// Add any other non-Spotify types here
