/**
 * Shared token-related types for consistent type safety across the application
 */

/**
 * Standard token response from API endpoints
 * Matches the response from /api/token and /api/auth/token
 */
export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type?: string
  scope?: string
}

/**
 * Token response that includes expires_at timestamp
 * Used by some endpoints like /api/token/[username]
 */
export interface TokenResponseWithExpiry extends TokenResponse {
  expires_at: number
}

/**
 * Error response from token API endpoints
 */
export interface TokenErrorResponse {
  error: string
  code?: string
  status?: number
}

/**
 * Health check response from token endpoints
 * Includes expiresIn for monitoring token expiry
 */
export interface TokenHealthResponse {
  access_token?: string
  expiresIn?: number
  expires_in?: number
  expires_at?: number
}

/**
 * Error codes that indicate the jukebox is offline
 */
export const OFFLINE_ERROR_CODES = [
  'TOKEN_REFRESH_ERROR',
  'PROFILE_UPDATE_ERROR',
  'INTERNAL_ERROR'
] as const

export type OfflineErrorCode = (typeof OFFLINE_ERROR_CODES)[number]
