import { SpotifyErrorResponse } from './types/spotify'

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

interface ApiProps {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: any
  extraHeaders?: Record<string, string>
  config?: Omit<RequestInit, 'method' | 'headers' | 'body'>
  isLocalApi?: boolean
  retryConfig?: {
    maxRetries?: number
    baseDelay?: number
    maxDelay?: number
  }
  debounceTime?: number // Custom debounce time in milliseconds
}

const SPOTIFY_API_URL =
  process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL || 'https://api.spotify.com/v1'

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
}

interface RateLimitState {
  requestCount: number
  resetTime: number
  windowSize: number
  maxRequestsPerWindow: number
  isRateLimited: boolean
  retryAfter: number
  lastRequestTime: number
  minRequestInterval: number
  isInitializing: boolean
  initializationRequestCount: number
  maxInitializationRequests: number
  initializationTimeout: number
}

const rateLimitState: RateLimitState = {
  requestCount: 0,
  resetTime: Date.now(),
  windowSize: 60000, // 1 minute window
  maxRequestsPerWindow: 50, // Conservative limit
  isRateLimited: false,
  retryAfter: 0,
  lastRequestTime: 0,
  minRequestInterval: 1000, // 1 second minimum between requests
  isInitializing: true,
  initializationRequestCount: 0,
  maxInitializationRequests: 10, // Limit initialization requests
  initializationTimeout: 15000 // 15 second initialization timeout
}

// Request queue for rate limiting
const requestQueue: Array<() => Promise<any>> = []
let isProcessingQueue = false

// Initialize rate limit state
setTimeout(() => {
  rateLimitState.isInitializing = false
}, rateLimitState.initializationTimeout)

async function processRequestQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
    const now = Date.now()

    // Check if we're rate limited
    if (rateLimitState.isRateLimited) {
      const waitTime = Math.max(0, rateLimitState.resetTime - now)
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }
      rateLimitState.isRateLimited = false
      rateLimitState.requestCount = 0
    }

    // During initialization, be extremely conservative with rate limits
    if (rateLimitState.isInitializing) {
      // Enforce minimum interval between requests
      const timeSinceLastRequest = now - rateLimitState.lastRequestTime
      if (timeSinceLastRequest < rateLimitState.minRequestInterval) {
        const waitTime =
          rateLimitState.minRequestInterval - timeSinceLastRequest
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }

      // Limit number of requests during initialization
      if (
        rateLimitState.initializationRequestCount >=
        rateLimitState.maxInitializationRequests
      ) {
        const waitTime = 2000 // 2 seconds between batches during initialization
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        rateLimitState.initializationRequestCount = 0
        continue
      }

      rateLimitState.lastRequestTime = now
      rateLimitState.initializationRequestCount++
    }

    // Check if we're in a new rate limit window
    if (now >= rateLimitState.resetTime) {
      rateLimitState.requestCount = 0
      rateLimitState.resetTime = now + rateLimitState.windowSize
      rateLimitState.isRateLimited = false
    }

    // Check if we've hit the rate limit
    if (rateLimitState.requestCount >= rateLimitState.maxRequestsPerWindow) {
      const waitTime = Math.max(0, rateLimitState.resetTime - now)
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }
      rateLimitState.requestCount = 0
      rateLimitState.resetTime = now + rateLimitState.windowSize
    }

    const request = requestQueue.shift()
    if (request) {
      try {
        rateLimitState.requestCount++
        await request()
      } catch (error) {
        if (addLog) {
          addLog(
            'ERROR',
            'Error processing queued request',
            'RateLimit',
            error as Error
          )
        } else {
          console.error('[Rate Limit] Error processing queued request:', error)
        }
        if (error instanceof ApiError && error.status === 429) {
          // The error already has the retry-after value from the response
          const retryAfter = error.retryAfter || 5 // Default to 5 seconds if no Retry-After header
          rateLimitState.isRateLimited = true
          rateLimitState.resetTime = now + retryAfter * 1000
          rateLimitState.retryAfter = retryAfter
          if (addLog) {
            addLog(
              'ERROR',
              `Rate limited by server. Retry after ${retryAfter}s`,
              'RateLimit'
            )
          } else {
            console.error(
              `[Rate Limit] Rate limited by server. Retry after ${retryAfter}s`
            )
          }

          // Add the request back to the front of the queue
          requestQueue.unshift(request)
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
        }
      }
    }
  }

  isProcessingQueue = false
}

const DEFAULT_DEBOUNCE_TIME = 1000 // 1 second default debounce
const requestCache = new Map<
  string,
  { promise: Promise<any>; timestamp: number }
>()

import { tokenManager } from './token/tokenManager'

// Add logging context
let addLog: (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

// Function to set the logging function
export function setApiLogger(logger: typeof addLog) {
  addLog = logger
}

export const sendApiRequest = async <T>({
  path,
  method = 'GET',
  body,
  extraHeaders,
  config = {},
  isLocalApi = false,
  retryConfig = DEFAULT_RETRY_CONFIG,
  debounceTime = DEFAULT_DEBOUNCE_TIME
}: ApiProps): Promise<T> => {
  const cacheKey = `${method}:${path}:${JSON.stringify(body)}`
  const now = Date.now()

  // Check if we have a cached request that's still valid
  const cachedRequest = requestCache.get(cacheKey)
  if (cachedRequest && now - cachedRequest.timestamp < debounceTime) {
    return cachedRequest.promise
  }

  const makeRequest = async (retryCount = 0): Promise<T> => {
    try {
      const baseUrl = isLocalApi ? '/api' : SPOTIFY_API_URL
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const url = `${baseUrl}${normalizedPath}`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(extraHeaders && { ...extraHeaders })
      }

      if (!isLocalApi) {
        const authToken = await tokenManager.getToken()
        if (!authToken) {
          throw new ApiError('Failed to get Spotify token')
        }
        headers['Authorization'] = `Bearer ${authToken}`
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        ...config
      })

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

        // Handle authentication errors with automatic token refresh
        if (response.status === 401 && !isLocalApi) {
          if (addLog) {
            addLog(
              'WARN',
              'Authentication error detected, attempting token refresh',
              'ApiRequest'
            )
          }

          try {
            // Clear token cache and force refresh
            tokenManager.clearCache()
            await tokenManager.getToken()

            if (addLog) {
              addLog('INFO', 'Token refreshed, retrying request', 'ApiRequest')
            }

            // Retry the request with fresh token
            return makeRequest(retryCount + 1)
          } catch (tokenError) {
            if (addLog) {
              addLog(
                'ERROR',
                'Token refresh failed',
                'ApiRequest',
                tokenError instanceof Error ? tokenError : undefined
              )
            }
            throw new ApiError('Authentication failed after token refresh', {
              status: 401,
              headers: response.headers
            })
          }
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(
            response.headers.get('Retry-After') || '0',
            10
          )
          rateLimitState.isRateLimited = true
          rateLimitState.resetTime = now + retryAfter * 1000
          rateLimitState.retryAfter = retryAfter

          if (addLog) {
            addLog(
              'ERROR',
              `Rate limited by server. Retry after ${retryAfter}s`,
              'RateLimit'
            )
          } else {
            console.error(
              `[Rate Limit] Rate limited by server. Retry after ${retryAfter}s`
            )
          }

          // If we have a Retry-After header, use that value
          if (retryAfter > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, retryAfter * 1000)
            )
            return makeRequest(retryCount + 1)
          }

          // Otherwise use exponential backoff
          const maxRetries =
            retryConfig?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries
          if (retryCount < maxRetries) {
            const baseDelay =
              retryConfig?.baseDelay ?? DEFAULT_RETRY_CONFIG.baseDelay
            const maxDelay =
              retryConfig?.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay
            const delay = Math.min(
              baseDelay * Math.pow(2, retryCount),
              maxDelay
            )
            if (addLog) {
              addLog(
                'INFO',
                `Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`,
                'RateLimit'
              )
            } else {
              console.log(
                `[Rate Limit] Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`
              )
            }
            await new Promise((resolve) => setTimeout(resolve, delay))
            return makeRequest(retryCount + 1)
          }
        }

        throw new ApiError(
          errorData.error.message || `API error: ${response.status}`,
          { status: response.status, headers: response.headers }
        )
      }

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        return {} as T
      }

      const data = await response.json()
      return data as T
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      throw new ApiError(
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while making API request'
      )
    }
  }

  const promise = new Promise<T>((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await makeRequest()
        resolve(result)
      } catch (error) {
        reject(error)
      }
    })
  })

  // Cache the promise
  requestCache.set(cacheKey, { promise, timestamp: now })

  // Start processing the queue if not already processing
  void processRequestQueue()

  return promise
}

import { TrackItem, SpotifyArtist } from './types/spotify'

export const logTrackSuggestion = async (
  track: TrackItem['track'],
  profileId: string
): Promise<void> => {
  try {
    // The track object from the playlist doesn't have genre information.
    // We need to fetch the artist details to get the genres.
    const artistDetails = await sendApiRequest<{ genres: string[] }>({
      path: `artists/${track.artists[0].id}`
    })

    await sendApiRequest({
      path: 'log-suggestion',
      method: 'POST',
      isLocalApi: true,
      body: {
        profile_id: profileId,
        track: {
          id: track.id,
          name: track.name,
          artists: [
            {
              name: track.artists[0].name,
              id: track.artists[0].id,
              genres: artistDetails.genres
            }
          ],
          album: track.album,
          duration_ms: track.duration_ms,
          popularity: track.popularity,
          external_urls: {
            spotify: `https://open.spotify.com/track/${track.id}`
          }
        }
      },
      debounceTime: 0
    })
  } catch (error) {
    console.error('Failed to log track suggestion:', error)
  }
}
