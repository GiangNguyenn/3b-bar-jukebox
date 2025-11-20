/**
 * Unified retry configuration for all retry logic in the application
 */
export interface RetryConfig {
  maxRetries?: number
  baseDelay?: number
  maxDelay?: number
}

/**
 * Default retry configuration
 * - 3 retry attempts (4 total attempts including initial)
 * - 1 second base delay
 * - 10 seconds maximum delay
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
}
