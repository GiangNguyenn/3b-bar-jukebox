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

interface SpotifyErrorResponse {
  error: {
    status: number
    message: string
    reason?: string
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfter?: number,
    public headers?: Headers
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const SPOTIFY_API_URL =
  process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL || 'https://api.spotify.com/v1'

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
}

// Rate limiting state
const rateLimitState = {
  requestCount: 0,
  resetTime: Date.now(),
  isRateLimited: false
}

// Request queue for rate limiting
const requestQueue: Array<() => Promise<any>> = []
let isProcessingQueue = false

async function processRequestQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (requestQueue.length > 0) {
    if (rateLimitState.isRateLimited) {
      const now = Date.now()
      if (now < rateLimitState.resetTime) {
        await new Promise((resolve) =>
          setTimeout(resolve, rateLimitState.resetTime - now)
        )
      }
      rateLimitState.isRateLimited = false
    }

    const request = requestQueue.shift()
    if (request) {
      try {
        await request()
      } catch (error) {
        console.error('Error processing queued request:', error)
      }
    }
  }

  isProcessingQueue = false
}

const DEBOUNCE_TIME = 10000 // 10 seconds in milliseconds
const requestCache = new Map<
  string,
  { promise: Promise<any>; timestamp: number }
>()

export const sendApiRequest = async <T>({
  path,
  method = 'GET',
  body,
  extraHeaders,
  config = {},
  isLocalApi = false,
  retryConfig = DEFAULT_RETRY_CONFIG,
  debounceTime = DEBOUNCE_TIME // Use custom debounce time if provided, otherwise use default
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
      const baseUrl = isLocalApi ? '' : SPOTIFY_API_URL
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const url = `${baseUrl}${normalizedPath}`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(extraHeaders && { ...extraHeaders })
      }

      if (!isLocalApi) {
        const authToken = await getSpotifyToken()
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
            response.status,
            undefined,
            response.headers
          )
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(
            response.headers.get('Retry-After') || '0',
            10
          )
          rateLimitState.isRateLimited = true
          rateLimitState.resetTime = Date.now() + retryAfter * 1000

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
            console.log(
              `Rate limited. Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`
            )
            await new Promise((resolve) => setTimeout(resolve, delay))
            return makeRequest(retryCount + 1)
          }
        }

        throw new ApiError(
          errorData.error.message || `API error: ${response.status}`,
          response.status,
          undefined,
          response.headers
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

  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await makeRequest()
          resolve(result)
      } catch (error) {
        reject(error)
      }
    })
    void processRequestQueue()
  })
}

const tokenCache: { token: string | null; expiry: number } = {
  token: null,
  expiry: 0
}

async function getSpotifyToken() {
  const now = Date.now()

  if (tokenCache.token && now < tokenCache.expiry) {
    return tokenCache.token
  }

  // Get the base URL for the token endpoint
  let baseUrl = ''

  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    // In browser, use the current origin
    baseUrl = window.location.origin
  } else {
    // In server-side code, use environment variable or default
    baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  }

  try {
    const response = await fetch(`${baseUrl}/api/token`, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Failed to fetch token:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
        url: `${baseUrl}/api/token`,
        environment: process.env.NODE_ENV,
        vercelUrl: process.env.VERCEL_URL,
        baseUrl
      })
      throw new Error(errorData.error || 'Failed to fetch Spotify token')
    }

    const data = await response.json()
    if (!data.access_token) {
      console.error('Invalid token response:', data)
      throw new Error('Invalid token response')
    }

    const newToken = data.access_token
    const newExpiry = now + data.expires_in * 1000

    tokenCache.token = newToken
    tokenCache.expiry = newExpiry

    return newToken
  } catch (error) {
    console.error('Error fetching token:', {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : error,
      baseUrl,
      environment: process.env.NODE_ENV,
      vercelUrl: process.env.VERCEL_URL
    })
    throw error
  }
}
