interface ApiProps {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: any
  extraHeaders?: Record<string, string>
  config?: Omit<RequestInit, 'method' | 'headers' | 'body'>
}

interface SpotifyErrorResponse {
  error: {
    status: number
    message: string
    reason?: string
  }
}

const SPOTIFY_API_URL =
  process.env.NEXT_PUBLIC_SPOTIFY_BASE_URL || 'https://api.spotify.com/v1'

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
  config = {}
}: ApiProps): Promise<T> => {
  const cacheKey = `${method}:${path}:${JSON.stringify(body)}`
  const now = Date.now()

  // Check if we have a cached request that's still valid
  const cachedRequest = requestCache.get(cacheKey)
  if (cachedRequest && now - cachedRequest.timestamp < DEBOUNCE_TIME) {
    console.log(`[API] Using cached request for ${cacheKey}`)
    return cachedRequest.promise
  }

  const authToken = await getSpotifyToken()
  if (!authToken) {
    throw new Error('Failed to get Spotify token')
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
    ...(extraHeaders && { ...extraHeaders })
  }

  const makeRequest = async (): Promise<T> => {
    try {
      const response = await fetch(`${SPOTIFY_API_URL}/${path}`, {
        method,
        headers: {
          ...headers,
          ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined,
        ...config
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData: SpotifyErrorResponse

        try {
          errorData = JSON.parse(errorText)
        } catch {
          throw new Error(`Spotify API error: ${response.status} ${response.statusText}`)
        }

        throw new Error(
          errorData.error.message || `Spotify API error: ${response.status}`
        )
      }

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        return {} as T
      }

      const data = await response.json()
      return data as T
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Unknown error occurred while making API request')
    }
  }

  // Create a new promise for this request
  const requestPromise = makeRequest()

  // Cache the promise and timestamp
  requestCache.set(cacheKey, {
    promise: requestPromise,
    timestamp: now
  })

  // Clean up old cache entries
  requestCache.forEach((value, key) => {
    if (now - value.timestamp >= DEBOUNCE_TIME) {
      requestCache.delete(key)
    }
  })

  return requestPromise
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
