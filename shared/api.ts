import { SpotifyErrorResponse } from './types/spotify'
import { getLogger } from './utils/logger'
import { cache } from './utils/cache'
import type { ApiStatisticsTracker } from '../services/game/apiStatisticsTracker'
import { categorizeApiCall } from '../services/game/apiStatisticsTracker'

export interface ApiErrorOptions {
  status?: number
  retryAfter?: number
  headers?: Headers
}

export class ApiError extends Error {
  public readonly status?: number
  public readonly retryAfter?: number
  public readonly headers?: Headers

  constructor(message: string, options?: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.status = options?.status
    this.retryAfter = options?.retryAfter
    this.headers = options?.headers
  }
}

type ApiLogger = (
  level: 'INFO' | 'ERROR' | 'WARN' | 'DEBUG',
  message: string,
  context?: string,
  error?: unknown
) => void

let apiLogger: ApiLogger | null = null

export const setApiLogger = (logger: ApiLogger): void => {
  apiLogger = logger
}

interface ApiProps {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: any
  extraHeaders?: Record<string, string>
  config?: Omit<RequestInit, 'method' | 'headers' | 'body'>
  isLocalApi?: boolean
  useAppToken?: boolean
  retryConfig?: {
    maxRetries?: number
    baseDelay?: number
    maxDelay?: number
  }
  debounceTime?: number
  public?: boolean
  token?: string
  statisticsTracker?: ApiStatisticsTracker
  timeout?: number
}

const SPOTIFY_API_URL =
  process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL || 'https://api.spotify.com/v1'

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
}

const DEFAULT_DEBOUNCE_TIME = 5000 // 5 second default debounce
const requestCache = new Map<
  string,
  { promise: Promise<any>; timestamp: number }
>()

const requestQueue: Array<() => Promise<any>> = []
let isProcessingQueue = false
// Global rate limit tracking
let globalRateLimitReset = 0

function isRateLimited(): boolean {
  return Date.now() < globalRateLimitReset
}

// Proactive Rate Limiter (Token Bucket)
// Allows burst of requests but throttles sustained load
export class RateLimitManager {
  private static readonly MAX_TOKENS = 50 // Max burst size
  private static readonly REFILL_RATE_MS = 600 // 1 token every 600ms (~100 calls/min)

  private static tokens = RateLimitManager.MAX_TOKENS
  private static lastRefill = Date.now()

  // Refill tokens based on time elapsed
  private static refillTokens() {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const newTokens = Math.floor(elapsed / this.REFILL_RATE_MS)

    if (newTokens > 0) {
      this.tokens = Math.min(this.MAX_TOKENS, this.tokens + newTokens)
      this.lastRefill = now
    }
  }

  /**
   * Check if a request can proceed.
   * @param consume - Whether to consume a token if available.
   * @returns true if request is allowed, false if rate limited.
   */
  public static checkLimit(consume: boolean = true): boolean {
    this.refillTokens()
    if (this.tokens >= 1) {
      if (consume) this.tokens -= 1
      return true
    }
    return false
  }

  public static get status() {
    this.refillTokens()
    return { tokens: this.tokens, max: this.MAX_TOKENS }
  }
}

async function processRequestQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
    // Check global rate limit before processing next item
    if (isRateLimited()) {
      const waitTime = globalRateLimitReset - Date.now()
      if (waitTime > 2000) {
        // If wait is long, pause queue processing
        // Re-schedule processing after wait time (capped at 5s to check again)
        const checkDelay = Math.min(waitTime, 5000)
        setTimeout(() => {
          isProcessingQueue = false
          void processRequestQueue()
        }, checkDelay)
        return
      }
    }

    const request = requestQueue.shift()
    if (request) {
      try {
        await request()
      } catch (error) {
        const log = await getLogger()
        log(
          'ERROR',
          'Error processing queued request',
          'RateLimit',
          error as Error
        )
      }
    }
  }

  isProcessingQueue = false
}

import { tokenManager } from './token/tokenManager'
import { getAppAccessToken } from '@/services/spotify/auth'

export const sendApiRequest = async <T>({
  path,
  method = 'GET',
  body,
  extraHeaders,
  config = {},
  isLocalApi = false,
  retryConfig = DEFAULT_RETRY_CONFIG,
  useAppToken = false,
  token: providedToken,
  debounceTime = DEFAULT_DEBOUNCE_TIME,
  statisticsTracker,
  timeout = 15000 // Default 15s timeout
}: ApiProps): Promise<T> => {
  // 1. Circuit Breaker: Fail fast if globally rate limited
  if (!isLocalApi && isRateLimited()) {
    const waitSeconds = Math.ceil((globalRateLimitReset - Date.now()) / 1000)
    console.warn(
      `[API] Global rate limit active. Blocking request to ${path}. Reset in ${waitSeconds}s`
    )
    throw new ApiError(
      `Global rate limit active. Try again in ${waitSeconds}s`,
      {
        status: 429,
        retryAfter: waitSeconds
      }
    )
  }

  const cacheKey = `${method}:${path}:${JSON.stringify(body)}`
  const now = Date.now()

  const cachedRequest = requestCache.get(cacheKey)
  if (cachedRequest && now - cachedRequest.timestamp < debounceTime) {
    return cachedRequest.promise
  }

  const makeRequest = async (retryCount = 0): Promise<T> => {
    const baseUrl = isLocalApi ? '/api' : SPOTIFY_API_URL
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const url = `${baseUrl}${normalizedPath}`
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(extraHeaders && { ...extraHeaders })
      }

      if (!isLocalApi) {
        const token =
          providedToken ??
          (useAppToken
            ? await getAppAccessToken()
            : await tokenManager.getToken())
        if (!token) {
          throw new ApiError(
            `Failed to get ${useAppToken ? 'app' : 'user'} Spotify token`
          )
        }
        headers['Authorization'] = `Bearer ${token}`
      }

      const startTime = Date.now()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      let response: Response
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          ...config
        })
      } finally {
        clearTimeout(timeoutId)
      }
      const durationMs = Date.now() - startTime

      // Track API calls using the statistics tracker
      if (statisticsTracker && !isLocalApi) {
        const operationType = categorizeApiCall(path)
        if (operationType) {
          statisticsTracker.recordApiCall(operationType, durationMs)
        }
      }

      if (!response.ok) {
        const errorText = await response.text()
        let errorData: SpotifyErrorResponse

        try {
          errorData = JSON.parse(errorText)
        } catch {
          throw new ApiError(
            `API error: ${response.status} ${response.statusText}`,
            { status: response.status, headers: response.headers }
          )
        }

        // Handle 401 Unauthorized - attempt token refresh and retry once
        if (response.status === 401 && !isLocalApi && retryCount === 0) {
          const log = await getLogger()
          log(
            'WARN',
            `Token expired, attempting to refresh and retry request: ${method} ${url}`,
            'TokenRefresh'
          )

          try {
            if (useAppToken) {
              // For app tokens, clear the cache and get a new token
              cache.delete('spotify-app-token')
              const newToken = await getAppAccessToken()
              if (!newToken) {
                throw new ApiError('Failed to refresh app token')
              }
            } else {
              // Clear the token cache to force a refresh
              tokenManager.clearCache()

              // Get a fresh token
              const newToken = await tokenManager.getToken()
              if (!newToken) {
                throw new ApiError('Failed to refresh token')
              }
            }

            // Retry the request with the new token
            return makeRequest(retryCount + 1)
          } catch (refreshError) {
            const log = await getLogger()
            log(
              'ERROR',
              `Token refresh failed: ${refreshError instanceof Error ? refreshError.message : 'Unknown error'}`,
              'TokenRefresh',
              refreshError instanceof Error ? refreshError : undefined
            )
            throw new ApiError('Token expired and refresh failed', {
              status: 401
            })
          }
        }

        // Log errors that won't be retried (or if retry failed)
        // Handle both { error: "string" } and { error: { message: "string" } } formats
        let errorMessage = `API error: ${response.status}`
        if (errorData) {
          const anyError = errorData as any
          if (typeof anyError.error === 'string') {
            errorMessage = anyError.error
          } else if (anyError.error?.message) {
            errorMessage = anyError.error.message
          } else if (anyError.message) {
            errorMessage = anyError.message
          }
        }
        if (apiLogger) {
          apiLogger(
            'ERROR',
            `[API Error] ${method}: ${url} - Status: ${response.status} - ${errorMessage}`,
            'API',
            errorData
          )
        } else {
          console.error(
            `[API Error] ${method}: ${url} - Status: ${response.status} - ${errorMessage}`,
            errorData
          )
        }

        if (response.status === 429) {
          const retryAfter =
            parseInt(response.headers.get('Retry-After') || '0', 10) || 5

          // Set global circuit breaker
          globalRateLimitReset = Date.now() + retryAfter * 1000

          const log = await getLogger()
          log(
            'ERROR',
            `Spotify API rate limit hit. Global block until ${new Date(globalRateLimitReset).toISOString()} (${retryAfter}s).`,
            'RateLimit'
          )

          // If retry is short (< 10s), we can wait and retry
          // Otherwise, fail the request to release resources and let the circuit breaker handle subsequent calls
          if (retryAfter <= 10) {
            await new Promise((resolve) =>
              setTimeout(resolve, retryAfter * 1000)
            )
            return makeRequest(retryCount + 1)
          } else {
            throw new ApiError(
              `Rate limit reached. Retry after ${retryAfter}s`,
              {
                status: 429,
                retryAfter,
                headers: response.headers
              }
            )
          }
        }

        // Check if this is a premium-related error and redirect accordingly
        if (typeof window !== 'undefined') {
          const isPremiumError =
            errorMessage.toLowerCase().includes('premium') ||
            errorMessage.toLowerCase().includes('subscription') ||
            errorMessage.toLowerCase().includes('upgrade') ||
            errorMessage.toLowerCase().includes('account type') ||
            errorMessage
              .toLowerCase()
              .includes('not available for your account')

          if (
            isPremiumError &&
            !window.location.pathname.includes('premium-required')
          ) {
            window.location.href = '/premium-required'
            throw new ApiError('Premium subscription required', {
              status: response.status
            })
          }
        }

        throw new ApiError(errorMessage, {
          status: response.status,
          headers: response.headers
        })
      }

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        return {} as T
      }

      const data = await response.json()

      return data as T
    } catch (error: unknown) {
      if (apiLogger) {
        apiLogger('ERROR', `[API Exception] ${method}: ${url}`, 'API', error)
      } else {
        console.error(`[API Exception] ${method}: ${url}`, error)
      }
      if (error instanceof ApiError) {
        throw error
      }
      // Handle abort (timeout) errors specifically
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(`Request timed out after ${timeout}ms`, {
          status: 408 // Request Timeout
        })
      }
      throw new ApiError(
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while making API request'
      )
    }
  }

  const promise = new Promise<T>((resolve, reject) => {
    // Create an overall timeout for the request (queueing + execution)
    const queueTimeoutId = setTimeout(() => {
      // If the request is still in the queue or executing when this fires,
      // fail the external promise. The background request may still complete
      // but its result will be ignored.
      reject(
        new ApiError(`Request timed out after ${timeout}ms`, {
          status: 408 // Request Timeout
        })
      )
    }, timeout)

    requestQueue.push(() =>
      makeRequest()
        .then((result) => {
          clearTimeout(queueTimeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(queueTimeoutId)
          reject(error)
        })
    )
    void processRequestQueue()
  })

  requestCache.set(cacheKey, { promise, timestamp: now })

  return promise
}

// Note: logTrackSuggestion function removed - suggested_tracks table should only be updated
// when users directly add tracks to their playlist, not from API suggestions
