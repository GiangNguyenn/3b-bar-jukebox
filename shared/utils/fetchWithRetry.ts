import { createModuleLogger } from './logger'
import { calculateBackoffDelay } from './retryHelpers'
import { isRetryableNetworkError } from './networkErrorDetection'
import { type RetryConfig, DEFAULT_RETRY_CONFIG } from './retryConfig'
import { connectivityInvestigator } from './connectivityInvestigator'

const logger = createModuleLogger('FetchRetry')

// Re-export for backward compatibility
export type FetchRetryConfig = RetryConfig
export const DEFAULT_FETCH_RETRY_CONFIG = DEFAULT_RETRY_CONFIG

/**
 * Wraps a fetch request with retry logic and exponential backoff
 * @param url The URL to fetch
 * @param init Optional fetch init options
 * @param config Optional retry configuration
 * @param requestName Optional name for logging purposes
 * @returns The fetch Response
 * @throws Error if all retry attempts fail
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  config: FetchRetryConfig = {},
  requestName?: string
): Promise<Response> {
  const retryConfig = { ...DEFAULT_FETCH_RETRY_CONFIG, ...config }
  const name = requestName ?? `Fetch ${url}`
  let lastError: Error | null = null
  let lastResponse: Response | undefined

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const response = await fetch(url, init)

      // If response is ok, return immediately
      if (response.ok) {
        if (attempt > 0) {
          logger(
            'INFO',
            `${name} succeeded on attempt ${attempt + 1}/${retryConfig.maxRetries + 1}`
          )
        }
        return response
      }

      // Check if we should retry this response status
      if (!isRetryableNetworkError(undefined, response)) {
        // Don't retry client errors (4xx except 408, 429)
        logger(
          'WARN',
          `${name} returned non-retryable status ${response.status}`,
          undefined,
          new Error(`HTTP ${response.status}`)
        )
        return response
      }

      // Store the response for potential retry
      lastResponse = response

      // If this is the last attempt, return the error response
      if (attempt >= retryConfig.maxRetries) {
        logger(
          'ERROR',
          `${name} failed with status ${response.status} after ${retryConfig.maxRetries + 1} attempts`
        )
        return response
      }

      // Calculate backoff delay
      const delay = calculateBackoffDelay(
        attempt,
        retryConfig.baseDelay,
        retryConfig.maxDelay
      )

      logger(
        'WARN',
        `${name} returned status ${response.status} (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), retrying in ${delay}ms`
      )

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (error) {
      // Handle network errors and exceptions
      lastError = error instanceof Error ? error : new Error(String(error))

      // Trigger connectivity investigation on first failure (background, non-blocking)
      if (attempt === 0 && isRetryableNetworkError(error)) {
        void connectivityInvestigator
          .investigate(error, {
            url,
            method: init?.method || 'GET',
            timestamp: Date.now(),
            headers: init?.headers as Record<string, string> | undefined
          })
          .catch((err) => {
            // Log investigation errors but don't throw
            logger(
              'WARN',
              'Connectivity investigation failed',
              undefined,
              err as Error
            )
          })
      }

      // Check if we should retry
      if (!isRetryableNetworkError(error)) {
        logger(
          'ERROR',
          `${name} threw non-retryable error`,
          undefined,
          lastError
        )
        throw lastError
      }

      // If this is the last attempt, throw the error
      if (attempt >= retryConfig.maxRetries) {
        logger(
          'ERROR',
          `${name} threw exception after ${retryConfig.maxRetries + 1} attempts`,
          undefined,
          lastError
        )
        throw lastError
      }

      // Calculate backoff delay
      const delay = calculateBackoffDelay(
        attempt,
        retryConfig.baseDelay,
        retryConfig.maxDelay
      )

      logger(
        'WARN',
        `${name} threw exception (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), retrying in ${delay}ms`,
        undefined,
        lastError
      )

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // This should never be reached, but handle it gracefully
  if (lastResponse) {
    return lastResponse
  }
  throw lastError ?? new Error(`${name} failed after all retry attempts`)
}
