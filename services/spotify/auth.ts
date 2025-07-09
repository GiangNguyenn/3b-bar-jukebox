import { cache } from '@/shared/utils/cache'
import { SpotifyTokenResponse } from '@/shared/types/spotify'

const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com/api/token'
const CACHE_KEY = 'spotify-app-token'
const CACHE_TTL_SECONDS = 3500 // 58 minutes

let authHeader: string

// This code should only run on the server
if (typeof window === 'undefined') {
  const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
  const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error(
      'Missing required environment variables: SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET'
    )
  }

  // Base64 encode client ID and secret
  authHeader = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')
}

/**
 * Retrieves a Spotify access token using the Client Credentials Flow.
 * The token is cached to avoid unnecessary requests.
 * @returns {Promise<string>} The Spotify access token.
 */
export const getAppAccessToken = async (): Promise<string> => {
  // Check cache first
  const cachedToken = cache.get<string>(CACHE_KEY)
  if (cachedToken) {
    return cachedToken
  }

  // If not in cache, fetch from Spotify API
  try {
    const response = await fetch(SPOTIFY_ACCOUNTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authHeader}`
      },
      body: 'grant_type=client_credentials'
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(
        `Failed to get app access token: ${response.status} ${response.statusText} - ${errorBody}`
      )
    }

    const tokenData = (await response.json()) as SpotifyTokenResponse
    const { access_token, expires_in } = tokenData

    // Cache the new token
    cache.set(CACHE_KEY, access_token, (expires_in || CACHE_TTL_SECONDS) * 1000)

    return access_token
  } catch (error) {
    console.error('Error fetching app access token:', error)
    throw new Error('Could not retrieve app access token from Spotify.')
  }
}
