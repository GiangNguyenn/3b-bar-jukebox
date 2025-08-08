import { SpotifyErrorResponse } from './types/spotify'
import { getLogger } from './utils/logger'

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

async function processRequestQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
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
  debounceTime = DEFAULT_DEBOUNCE_TIME
}: ApiProps): Promise<T> => {
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

        if (apiLogger) {
          apiLogger(
            'ERROR',
            `[API Error] ${method}: ${url} - Status: ${response.status}`,
            'API',
            errorData
          )
        } else {
          console.error(
            `[API Error] ${method}: ${url} - Status: ${response.status}`,
            errorData
          )
        }

        // Handle 401 Unauthorized - attempt token refresh and retry once
        if (
          response.status === 401 &&
          !isLocalApi &&
          !useAppToken &&
          retryCount === 0
        ) {
          const log = await getLogger()
          log(
            'WARN',
            `Token expired, attempting to refresh and retry request: ${method} ${url}`,
            'TokenRefresh'
          )

          try {
            // Clear the token cache to force a refresh
            tokenManager.clearCache()

            // Get a fresh token
            const newToken = await tokenManager.getToken()
            if (!newToken) {
              throw new ApiError('Failed to refresh token')
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

        if (response.status === 429) {
          const retryAfter =
            parseInt(response.headers.get('Retry-After') || '0', 10) || 5
          const log = await getLogger()
          log(
            'ERROR',
            `Spotify API rate limit hit. Waiting for ${retryAfter} seconds before retrying.`,
            'RateLimit'
          )
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
          return makeRequest(retryCount + 1)
        }

        const errorMessage =
          errorData.error.message || `API error: ${response.status}`

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
    } catch (error) {
      if (apiLogger) {
        apiLogger('ERROR', `[API Exception] ${method}: ${url}`, 'API', error)
      } else {
        console.error(`[API Exception] ${method}: ${url}`, error)
      }
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
    requestQueue.push(() => makeRequest().then(resolve).catch(reject))
    void processRequestQueue()
  })

  requestCache.set(cacheKey, { promise, timestamp: now })

  return promise
}

// Note: logTrackSuggestion function removed - suggested_tracks table should only be updated
// when users directly add tracks to their playlist, not from API suggestions
