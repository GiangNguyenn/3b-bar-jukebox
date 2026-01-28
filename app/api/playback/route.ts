import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import {
  transferPlaybackToDevice,
  validateDevice
} from '@/services/deviceManagement'
import { createModuleLogger } from '@/shared/utils/logger'
import type { Database } from '@/types/supabase'

import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

// Set up logger for this module
const logger = createModuleLogger('PlaybackAPI')

interface PlaybackRequest {
  action: 'play' | 'pause'
  contextUri?: string
  deviceId?: string
  position_ms?: number
}

interface UserProfile {
  id: string
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
}

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAY_MS = 1000

/**
 * Helper function to update token in database with retry logic
 */
async function updateTokenWithRetry(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string,
  tokenData: {
    accessToken: string
    refreshToken: string
    expiresIn: number
    currentRefreshToken: string
  },
  username: string
): Promise<{ success: boolean; error?: Error }> {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const result = await updateTokenInDatabase(supabase, userId, tokenData)

    if (result.success) {
      logger(
        'INFO',
        `Token database update succeeded for user ${username} on attempt ${attempt}`
      )
      return { success: true }
    }

    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1) // Exponential backoff
      logger(
        'WARN',
        `Token database update failed for user ${username}, attempt ${attempt}/${MAX_RETRY_ATTEMPTS}, retrying in ${delay}ms...`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    } else {
      logger(
        'ERROR',
        `Token database update failed for user ${username} after ${MAX_RETRY_ATTEMPTS} attempts: ${result.error?.message}`
      )
      return {
        success: false,
        error: result.error
          ? new Error(result.error.message)
          : new Error('Update failed')
      }
    }
  }

  return { success: false, error: new Error('Max retries exceeded') }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      logger('ERROR', 'Missing Spotify client credentials in environment')
      throw new Error('Missing Spotify credentials')
    }

    // Extract username from query parameters
    const { searchParams } = new URL(request.url)
    const username = searchParams.get('username')

    if (!username) {
      logger('ERROR', 'Playback API called without username parameter')
      return NextResponse.json(
        { error: 'Username parameter is required' },
        { status: 400 }
      )
    }

    const cookieStore = cookies()
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Expected: The `setAll` method was called from a Server Component.
              // This is a known Next.js behavior and can be safely ignored.
              // See: https://supabase.com/docs/guides/auth/server-side/creating-a-client
            }
          }
        }
      }
    )

    // Get user profile from database based on username parameter
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .ilike('display_name', username)
      .single()

    if (profileError || !userProfile) {
      logger(
        'ERROR',
        `Error fetching profile for user "${username}": ${JSON.stringify(profileError)}`
      )
      return NextResponse.json(
        { error: `Failed to get credentials for user: ${username}` },
        { status: 404 }
      )
    }

    const typedProfile = userProfile as UserProfile
    let accessToken = typedProfile.spotify_access_token

    // Check if token needs refresh
    const tokenExpiresAt = typedProfile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)

    if (tokenExpiresAt && tokenExpiresAt <= now) {
      logger('INFO', `Token expired for user ${username}, refreshing...`)

      if (!typedProfile.spotify_refresh_token) {
        logger('ERROR', `No refresh token available for user ${username}`)
        return NextResponse.json(
          { error: 'No refresh token available' },
          { status: 500 }
        )
      }

      const refreshResult = await refreshTokenWithRetry(
        typedProfile.spotify_refresh_token,
        SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET
      )

      if (!refreshResult.success || !refreshResult.accessToken) {
        logger(
          'ERROR',
          `Token refresh failed for user ${username}: ${refreshResult.error instanceof Error ? refreshResult.error.message : 'Unknown error'}`
        )
        return NextResponse.json(
          { error: 'Failed to refresh token' },
          { status: 503 }
        )
      }

      accessToken = refreshResult.accessToken

      // Update the token in the database with retry logic
      const updateResult = await updateTokenWithRetry(
        supabase,
        String(userProfile.id),
        {
          accessToken: refreshResult.accessToken,
          refreshToken:
            refreshResult.refreshToken ?? typedProfile.spotify_refresh_token,
          expiresIn: refreshResult.expiresIn ?? 3600,
          currentRefreshToken: typedProfile.spotify_refresh_token
        },
        username
      )

      if (!updateResult.success) {
        logger(
          'ERROR',
          `Failed to update token in database for user ${username} after ${MAX_RETRY_ATTEMPTS} retries. This may cause subsequent token refresh issues.`
        )
        return NextResponse.json(
          { error: 'Failed to persist refreshed token' },
          { status: 500 }
        )
      }

      logger(
        'INFO',
        `Token successfully refreshed and updated for user ${username}`
      )
    }

    if (!accessToken) {
      logger('ERROR', `No access token available for user ${username}`)
      return NextResponse.json(
        { error: 'No access token available' },
        { status: 500 }
      )
    }

    // Fetch full playback state including device info
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.status === 204) {
      return NextResponse.json(null)
    }

    if (!response.ok) {
      const errorText = await response.text()
      logger(
        'ERROR',
        `Spotify API error for user ${username} (status ${response.status}): ${errorText}`
      )
      return NextResponse.json(
        { error: 'Spotify API error' },
        { status: response.status }
      )
    }

    const data: unknown = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger(
      'ERROR',
      `Error in playback API GET: ${errorMessage}`,
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { action, contextUri, deviceId, position_ms } =
      (await request.json()) as PlaybackRequest

    if (!deviceId) {
      return NextResponse.json(
        { error: 'Device ID is required' },
        { status: 400 }
      )
    }

    // First ensure device is healthy
    const deviceValidation = await validateDevice(deviceId)
    if (!deviceValidation.isValid || !deviceValidation.device?.isActive) {
      return NextResponse.json(
        {
          error: `Device is not healthy: ${deviceValidation.errors.join(', ')}`
        },
        { status: 400 }
      )
    }

    // Transfer playback to device
    const transferred = await transferPlaybackToDevice(deviceId)
    if (!transferred) {
      return NextResponse.json(
        { error: 'Failed to transfer playback to device' },
        { status: 500 }
      )
    }

    // Make the appropriate API call based on action
    if (action === 'play') {
      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: deviceId,
          context_uri: contextUri,
          position_ms: position_ms
        }
      })
    } else if (action === 'pause') {
      await sendApiRequest({
        path: 'me/player/pause',
        method: 'PUT',
        body: {
          device_id: deviceId
        }
      })
    }

    // Recovery verification removed; no additional state fetch needed

    return NextResponse.json({ success: true })
  } catch (error) {
    logger(
      'ERROR',
      'Error in playback API:',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
