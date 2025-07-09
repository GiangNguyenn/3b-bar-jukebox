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
      if (apiLogger) {
        apiLogger('INFO', `[API Request] ${method}: ${url}`, 'API')
      } else {
        console.log(`[API Request] ${method}: ${url}`)
      }

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
      if (apiLogger) {
        apiLogger(
          'INFO',
          `[API Success] ${method}: ${url} - Status: ${response.status}`,
          'API'
        )
      } else {
        console.log(
          `[API Success] ${method}: ${url} - Status: ${response.status}`
        )
      }
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

import { TrackItem } from './types/spotify'

export const logTrackSuggestion = async (
  track: TrackItem['track'],
  profileId: string
): Promise<void> => {
  try {
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
    const log = await getLogger()
    log(
      'ERROR',
      'Failed to log track suggestion',
      'TrackSuggestion',
      error as Error
    )
  }
}
