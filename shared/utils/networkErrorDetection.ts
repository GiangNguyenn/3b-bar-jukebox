/**
 * Network error detection utilities for retry logic and error categorization
 */

/**
 * Network error message patterns that indicate retryable network failures
 */
const NETWORK_ERROR_PATTERNS = [
  'network',
  'timeout',
  'connection',
  'fetch failed',
  'failed to fetch',
  'econnrefused',
  'etimedout',
  'enotfound',
  'network request failed',
  'err_connection_closed',
  'connection closed',
  'connection reset'
] as const

/**
 * Determines if an error is network-related based on error type and message
 * @param error - The error to check
 * @returns true if the error appears to be network-related
 */
export function isNetworkError(error: unknown): boolean {
  // Fetch throws TypeError for network failures
  if (error instanceof TypeError) {
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
  }

  return false
}

/**
 * Determines if an error or response should trigger a retry
 * Handles both Error objects and Response objects
 *
 * @param error - The error to check (optional)
 * @param response - The Response object to check (optional)
 * @returns true if the error/response indicates a retryable condition
 */
export function isRetryableNetworkError(
  error?: unknown,
  response?: Response
): boolean {
  // If we have a response, check status code first
  if (response) {
    // Don't retry 4xx client errors (except 408 Request Timeout and 429 Too Many Requests)
    if (response.status >= 400 && response.status < 500) {
      return response.status === 408 || response.status === 429
    }
    // Retry 5xx server errors
    if (response.status >= 500) {
      return true
    }
    // Success responses shouldn't trigger retry
    return false
  }

  // Check for network errors if we have an error object
  if (error !== undefined && error !== null) {
    return isNetworkError(error)
  }

  // Default: retry on unknown errors (could be network issues)
  return true
}

/**
 * Categorizes an error for user-facing messages
 * @param error - The error to categorize
 * @returns Object with error type and user-friendly message
 */
export function categorizeNetworkError(error: unknown): {
  type: 'network' | 'api' | 'unknown'
  message: string
} {
  if (error instanceof TypeError) {
    // Fetch throws TypeError for network failures
    return {
      type: 'network',
      message:
        'Network connection failed. Please check your internet connection.'
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Check for network-related patterns
    if (
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('failed to fetch') ||
      message.includes('connection')
    ) {
      return {
        type: 'network',
        message:
          'Network connection failed. Please check your internet connection.'
      }
    }

    if (message.includes('timeout')) {
      return {
        type: 'network',
        message: 'Request timed out. Please try again.'
      }
    }

    // API-level errors (non-network)
    return {
      type: 'api',
      message: error.message
    }
  }

  return {
    type: 'unknown',
    message: 'An unexpected error occurred.'
  }
}
