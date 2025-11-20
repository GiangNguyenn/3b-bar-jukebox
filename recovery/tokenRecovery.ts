import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('TokenRecovery')

export interface TokenRefreshError {
  code: string
  message: string
  isRecoverable: boolean
  retryAfter?: number // For rate limiting (seconds)
}

export interface TokenRefreshResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: TokenRefreshError
}

interface SpotifyErrorResponse {
  error?: string
  error_description?: string
}

/**
 * Parses Spotify error response to determine error type and recoverability
 */
export function parseSpotifyError(
  response: Response,
  errorText: string
): TokenRefreshError {
  let errorCode = 'UNKNOWN_ERROR'
  let errorMessage = 'Unknown error occurred'
  let isRecoverable = false
  let retryAfter: number | undefined

  // Try to parse JSON error response
  try {
    const errorData = JSON.parse(errorText) as SpotifyErrorResponse
    errorCode = errorData.error ?? 'UNKNOWN_ERROR'
    errorMessage =
      errorData.error_description ?? errorData.error ?? errorMessage
  } catch {
    // If not JSON, use the raw text
    errorMessage =
      errorText || `HTTP ${response.status}: ${response.statusText}`
  }

  // Check for rate limiting
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After')
    if (retryAfterHeader) {
      retryAfter = parseInt(retryAfterHeader, 10)
    }
    return {
      code: 'RATE_LIMITED',
      message: `Rate limited. Retry after ${retryAfter ?? 'unknown'} seconds`,
      isRecoverable: true,
      retryAfter
    }
  }

  // Classify error based on Spotify error codes
  switch (errorCode) {
    case 'invalid_grant':
      // Refresh token is invalid, expired, or revoked
      return {
        code: 'INVALID_REFRESH_TOKEN',
        message:
          'Refresh token is invalid or expired. Please reconnect your Spotify account.',
        isRecoverable: false
      }

    case 'invalid_client':
      // Client credentials are invalid
      return {
        code: 'INVALID_CLIENT_CREDENTIALS',
        message:
          'Spotify client credentials are invalid. Please check server configuration.',
        isRecoverable: false
      }

    case 'invalid_request':
      // Malformed request
      return {
        code: 'INVALID_REQUEST',
        message: 'Invalid token refresh request',
        isRecoverable: false
      }

    default:
      // For 5xx errors, consider them recoverable (transient server issues)
      if (response.status >= 500) {
        return {
          code: 'TRANSIENT_ERROR',
          message: `Spotify service error (${response.status}). Please retry.`,
          isRecoverable: true
        }
      }

      // For 4xx errors (except the ones we handle above), consider non-recoverable
      if (response.status >= 400 && response.status < 500) {
        return {
          code: 'CLIENT_ERROR',
          message: `Client error (${response.status}): ${errorMessage}`,
          isRecoverable: false
        }
      }

      // Unknown errors are treated as potentially recoverable
      return {
        code: 'UNKNOWN_ERROR',
        message: errorMessage,
        isRecoverable: true
      }
  }
}

/**
 * Determines if a network error is recoverable
 */
export function isNetworkErrorRecoverable(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    // Network errors are typically recoverable
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    // Timeout and connection errors are recoverable
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('econnrefused')
    ) {
      return true
    }
  }

  return false
}

/**
 * Attempts to refresh a token with retry logic and exponential backoff
 */
export async function refreshTokenWithRetry(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  maxRetries = 3,
  baseDelay = 1000
): Promise<TokenRefreshResult> {
  const tokenUrl = 'https://accounts.spotify.com/api/token'

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      })

      if (response.ok) {
        const tokenData = (await response.json()) as {
          access_token: string
          refresh_token?: string
          expires_in: number
        }

        logger('INFO', `Token refresh successful (attempt ${attempt + 1})`)

        return {
          success: true,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in
        }
      }

      // Parse error response
      const errorText = await response.text()
      const error = parseSpotifyError(response, errorText)

      // If error is not recoverable, don't retry
      if (!error.isRecoverable) {
        logger(
          'ERROR',
          `Token refresh failed (non-recoverable): ${error.code} - ${error.message}`
        )
        return {
          success: false,
          error
        }
      }

      // If this is the last attempt, return the error
      if (attempt === maxRetries) {
        logger(
          'ERROR',
          `Token refresh failed after ${maxRetries + 1} attempts: ${error.code} - ${error.message}`
        )
        return {
          success: false,
          error
        }
      }

      // Calculate delay with exponential backoff
      // Respect Retry-After header if present
      let delay = baseDelay * Math.pow(2, attempt)
      if (error.retryAfter) {
        delay = error.retryAfter * 1000 // Convert to milliseconds
      }

      logger(
        'WARN',
        `Token refresh attempt ${attempt + 1} failed (recoverable), retrying in ${delay}ms: ${error.message}`
      )

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (error) {
      // Handle network errors
      const isRecoverable = isNetworkErrorRecoverable(error)

      if (!isRecoverable) {
        logger(
          'ERROR',
          `Token refresh failed (non-recoverable network error)`,
          'TokenRecovery',
          error instanceof Error ? error : undefined
        )
        return {
          success: false,
          error: {
            code: 'NETWORK_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Network error during token refresh',
            isRecoverable: false
          }
        }
      }

      // If this is the last attempt, return the error
      if (attempt === maxRetries) {
        logger(
          'ERROR',
          `Token refresh failed after ${maxRetries + 1} attempts (network error)`,
          'TokenRecovery',
          error instanceof Error ? error : undefined
        )
        return {
          success: false,
          error: {
            code: 'NETWORK_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Network error during token refresh',
            isRecoverable: true
          }
        }
      }

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt)

      logger(
        'WARN',
        `Token refresh attempt ${attempt + 1} failed (network error), retrying in ${delay}ms`,
        'TokenRecovery',
        error instanceof Error ? error : undefined
      )

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // Should never reach here, but TypeScript needs this
  return {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'Token refresh failed after all retries',
      isRecoverable: false
    }
  }
}

/**
 * Determines if a token refresh error requires user action
 */
export function requiresUserAction(error: TokenRefreshError): boolean {
  return (
    error.code === 'INVALID_REFRESH_TOKEN' ||
    error.code === 'INVALID_CLIENT_CREDENTIALS' ||
    error.code === 'INVALID_REQUEST'
  )
}

/**
 * Gets a user-friendly error message for display in the UI
 */
export function getUserFriendlyErrorMessage(error: TokenRefreshError): string {
  switch (error.code) {
    case 'INVALID_REFRESH_TOKEN':
      return 'Please reconnect your Spotify account'
    case 'INVALID_CLIENT_CREDENTIALS':
      return 'Server configuration error. Please contact support.'
    case 'RATE_LIMITED':
      return `Rate limited. Retrying in ${error.retryAfter ?? 'a few'} seconds...`
    case 'TRANSIENT_ERROR':
      return 'Temporary service issue. Retrying...'
    case 'NETWORK_ERROR':
      return 'Network error. Retrying...'
    default:
      return 'Token refresh failed. Please try again.'
  }
}
