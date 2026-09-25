import { SpotifyErrorResponse } from './types/spotify'
import { getLogger } from './utils/logger'
import { cache } from './utils/cache'
import type { ApiStatisticsTracker } from './apiCallCategorizer'
import { categorizeApiCall } from './apiCallCategorizer'

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

/**
 * Turns a caught error into a short, user-facing explanation of what went
 * wrong. Callers making user-initiated requests (button clicks, sliders)
 * should show this rather than letting failures reach only the diagnostic
 * log — a global rate-limit trip otherwise looks identical to "the button
 * is broken" from the user's perspective.
 */
export function describeApiFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429) {
    return 'Spotify is rate-limiting requests — please wait a few seconds and try again.'
  }
  return fallback
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

// Drop expired entries once the map grows, so a long-running session with
// many distinct request keys does not keep every response promise alive.
function pruneRequestCache(now: number, maxAgeMs: number): void {
  if (requestCache.size < 200) return
  requestCache.forEach((entry, key) => {
    if (now - entry.timestamp >= maxAgeMs) requestCache.delete(key)
  })
}

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

  public static get status(): { tokens: number; max: number } {
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
import { recoveryManager } from '@/services/player/recoveryManager'

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
  timeout = 30000 // Default 30s timeout to allow for IPv6 fallback
}: ApiProps): Promise<T> => {
  // 0. Suspension Guard: Fail fast if token recovery is in progress
  if (
    !isLocalApi &&
    !providedToken &&
    !useAppToken &&
    recoveryManager.isTokenSuspended()
  ) {
    throw new ApiError('Token refresh suspended — recovery in progress', {
      status: 503
    })
  }

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

  // Only reads are de-duplicated. Sharing a cached promise for a mutation
  // turns every retry within the debounce window into a replay of the first
  // attempt's result: a failed PUT me/player/play retried 500ms later would
  // "fail" again without ever reaching Spotify.
  const isCacheable = method === 'GET'
  const cacheKey = `${method}:${path}:${JSON.stringify(body)}`
  const now = Date.now()

  const cachedRequest = isCacheable ? requestCache.get(cacheKey) : undefined
  if (cachedRequest && now - cachedRequest.timestamp < debounceTime) {
    return cachedRequest.promise
  }

  const makeRequest = async (
    retryCount = 0,
    extendQueueTimeout?: (duration: number) => void
  ): Promise<T> => {
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
        headers.Authorization = `Bearer ${token}`
      }

      const startTime = Date.now()
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () =>
          controller.abort(`Timeout after ${timeout}ms for ${method} ${url}`),
        timeout
      )

      // The abort timer stays armed until the body has been read (see the
      // finally below): a response whose headers arrive but whose body then
      // stalls would otherwise hang forever and wedge the request queue.
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          ...config
        })
        return await handleResponse(response, Date.now() - startTime)
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error: unknown) {
      if (apiLogger) {
        apiLogger('ERROR', `[API Exception] ${method}: ${url}`, 'API', error)
      } else {
        console.error(`[API Exception] ${method}: ${url}`, error)
      }
      if (error instanceof ApiError) {
        throw error
      }
      // Handle abort (timeout) errors specifically. abort(reason) rejects
      // with the reason itself, which is a string here, not an AbortError.
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        typeof error === 'string'
      ) {
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

    async function handleResponse(
      response: Response,
      durationMs: number
    ): Promise<T> {
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

          // Extend the queue-level timeout to give the token refresh + retry enough time
          // Token refresh can take up to 10s (fetchWithTimeout) + retry fetch up to 30s
          if (extendQueueTimeout) {
            extendQueueTimeout(timeout + 15000)
          }

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
            return makeRequest(retryCount + 1, extendQueueTimeout)
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
            return makeRequest(retryCount + 1, extendQueueTimeout)
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

        // Retry on transient Spotify server errors (502, 503, 504)
        // 501 Not Implemented is excluded — it won't succeed on retry.
        const maxRetries =
          retryConfig.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries
        const baseDelay =
          retryConfig.baseDelay ?? DEFAULT_RETRY_CONFIG.baseDelay
        const maxDelay = retryConfig.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay
        if (
          response.status >= 500 &&
          response.status !== 501 &&
          retryCount < maxRetries
        ) {
          const backoff = Math.min(
            baseDelay * Math.pow(2, retryCount),
            maxDelay
          )
          const log = await getLogger()
          log(
            'WARN',
            `Spotify ${response.status} error, retrying in ${backoff}ms (attempt ${retryCount + 1}/${maxRetries})`,
            'API'
          )
          await new Promise((resolve) => setTimeout(resolve, backoff))
          return makeRequest(retryCount + 1, extendQueueTimeout)
        }

        throw new ApiError(errorMessage, {
          status: response.status,
          headers: response.headers
        })
      }

      const contentType = response.headers.get('content-type')
      if (!contentType?.includes('application/json')) {
        return {} as T
      }

      const data = await response.json()

      return data as T
    }
  }

  const promise = new Promise<T>((resolve, reject) => {
    // Create an overall timeout for the request (queueing + execution)
    // Use an object so the 401 retry path can extend the timeout
    const timeoutState = { id: 0 as unknown as ReturnType<typeof setTimeout> }
    let settled = false
    // Resolves when the caller has been given an answer, so the queue can
    // move on even if makeRequest itself never settles.
    let releaseQueueSlot: () => void = () => {}
    const queueSlotReleased = new Promise<void>((release) => {
      releaseQueueSlot = release
    })
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutState.id)
      fn()
      releaseQueueSlot()
    }
    const startQueueTimeout = (duration: number) => {
      clearTimeout(timeoutState.id)
      timeoutState.id = setTimeout(() => {
        settle(() =>
          reject(
            new ApiError(`Request timed out after ${duration}ms`, {
              status: 408
            })
          )
        )
      }, duration)
    }
    startQueueTimeout(timeout)

    requestQueue.push(() => {
      // The caller already gave up while this sat in the queue. Sending it
      // now would only replay a stale command (e.g. a play request minutes
      // after the track it was for).
      if (settled) return Promise.resolve()

      makeRequest(0, startQueueTimeout)
        .then((result) => settle(() => resolve(result)))
        .catch((error: unknown) =>
          settle(() =>
            reject(error instanceof Error ? error : new Error(String(error)))
          )
        )
      return queueSlotReleased
    })
    void processRequestQueue()
  })

  if (isCacheable) {
    requestCache.set(cacheKey, { promise, timestamp: now })
    pruneRequestCache(now, debounceTime)
  }

  return promise
}
