/**
 * Token-related constants for consistent configuration across the application
 */

/**
 * Error codes that indicate the jukebox is offline
 * Re-exported from shared/types/token.ts for convenience
 */
export { OFFLINE_ERROR_CODES } from '@/shared/types/token'

/**
 * Token expiry thresholds in seconds
 */
export const TOKEN_EXPIRY_THRESHOLDS = {
  /** Critical threshold - token expiring in less than 1 minute */
  CRITICAL: 60,
  /** Warning threshold - token expiring in less than 5 minutes */
  WARNING: 300,
  /** Default refresh threshold - refresh token 5 minutes before expiry */
  REFRESH: 300
} as const

/**
 * Token health check interval in milliseconds
 */
export const TOKEN_HEALTH_CHECK_INTERVAL = 30000 // 30 seconds

/**
 * Token refresh check interval in milliseconds (for proactive refresh)
 */
export const TOKEN_REFRESH_CHECK_INTERVAL = 60000 // 60 seconds
