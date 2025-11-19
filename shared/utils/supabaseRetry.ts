import { createModuleLogger } from './logger'

const logger = createModuleLogger('SupabaseRetry')

export interface RetryConfig {
  maxRetries?: number
  baseDelay?: number
  maxDelay?: number
}

export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
}

/**
 * Determines if an error should trigger a retry
 * Retries on: network errors, timeouts, 5xx errors
 * Skips retries on: 4xx client errors (400, 401, 403, 404, etc.)
 */
function shouldRetry(error: unknown): boolean {
  if (!error) return false

  // Check if it's a Supabase error object
  if (typeof error === 'object' && error !== null) {
    const supabaseError = error as {
      code?: string
      message?: string
      status?: number
      statusCode?: number
    }

    // Check for HTTP status codes
    const statusCode = supabaseError.status ?? supabaseError.statusCode

    if (statusCode !== undefined) {
      // Don't retry 4xx client errors
      if (statusCode >= 400 && statusCode < 500) {
        return false
      }
      // Retry 5xx server errors
      if (statusCode >= 500) {
        return true
      }
    }

    // Check for specific Supabase error codes that indicate retryable errors
    const code = supabaseError.code
    if (code) {
      // Network/connection errors
      if (
        code === 'PGRST301' || // Connection timeout
        code === 'PGRST302' || // Connection error
        code.startsWith('ECONN') || // Connection errors
        code.startsWith('ETIMEDOUT') // Timeout errors
      ) {
        return true
      }

      // Don't retry on specific client errors
      if (
        code === 'PGRST116' || // Not found
        code === '23505' || // Unique violation
        code === '23503' || // Foreign key violation
        code === '23502' // Not null violation
      ) {
        return false
      }
    }
  }

  // Check if it's a network error (Error object with network-related messages)
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('fetch failed') ||
      message.includes('econnrefused') ||
      message.includes('etimedout')
    ) {
      return true
    }
  }

  // Default: retry on unknown errors (could be network issues)
  return true
}

/**
 * Calculates exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * 0.3 * exponentialDelay // Add up to 30% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelay)
  return Math.floor(delay)
}

/**
 * Wraps a Supabase query with retry logic and exponential backoff
 * @param queryFn Function that returns a Supabase query promise
 * @param config Optional retry configuration
 * @param queryName Optional name for logging purposes
 * @returns The result of the query with { data, error } structure
 */
export async function withRetry<TData, TError = unknown>(
  queryFn: () => Promise<{ data: TData | null; error: TError | null }>,
  config: RetryConfig = {},
  queryName = 'Supabase query'
): Promise<{ data: TData | null; error: TError | null }> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: TError | null = null
  let lastData: TData | null = null

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const result = await queryFn()

      // If there's no error, return immediately
      if (!result.error) {
        return result
      }

      // Check if we should retry this error
      if (!shouldRetry(result.error)) {
        // Don't retry client errors (4xx)
        return result
      }

      // Store the error for potential retry
      lastError = result.error
      lastData = result.data

      // If this is the last attempt, return the error
      if (attempt >= retryConfig.maxRetries) {
        logger(
          'ERROR',
          `${queryName} failed after ${retryConfig.maxRetries + 1} attempts`,
          undefined,
          result.error instanceof Error ? result.error : undefined
        )
        return result
      }

      // Calculate backoff delay
      const delay = calculateBackoffDelay(
        attempt,
        retryConfig.baseDelay,
        retryConfig.maxDelay
      )

      logger(
        'WARN',
        `${queryName} failed (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), retrying in ${delay}ms`,
        undefined,
        result.error instanceof Error ? result.error : undefined
      )

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (error) {
      // Handle exceptions thrown by the query function
      lastError = error as TError

      // Check if we should retry
      if (!shouldRetry(error)) {
        return { data: null, error: error as TError }
      }

      // If this is the last attempt, return the error
      if (attempt >= retryConfig.maxRetries) {
        logger(
          'ERROR',
          `${queryName} threw exception after ${retryConfig.maxRetries + 1} attempts`,
          undefined,
          error instanceof Error ? error : undefined
        )
        return { data: null, error: error as TError }
      }

      // Calculate backoff delay
      const delay = calculateBackoffDelay(
        attempt,
        retryConfig.baseDelay,
        retryConfig.maxDelay
      )

      logger(
        'WARN',
        `${queryName} threw exception (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), retrying in ${delay}ms`,
        undefined,
        error instanceof Error ? error : undefined
      )

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // This should never be reached, but TypeScript needs it
  return { data: lastData, error: lastError }
}
