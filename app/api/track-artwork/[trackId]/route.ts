import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { SpotifyTokenResponse } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Track Artwork')

interface UserProfile {
  id: string
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expires_at: number | null
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

// Environment variables
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  throw new Error(
    'Missing required environment variables: SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET'
  )
}

export async function GET(
  request: Request,
  { params }: { params: { trackId: string } }
): Promise<NextResponse<{ artworkUrl: string | null } | ErrorResponse>> {
  try {
    const { trackId } = params

    if (!trackId) {
      logger('ERROR', 'Track artwork API: No track ID provided')
      return NextResponse.json(
        {
          error: 'Track ID is required',
          code: 'MISSING_TRACK_ID',
          status: 400
        },
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
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          }
        }
      }
    )

    // Get admin profile from database - use '3B' as the default admin username
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .ilike('display_name', '3B')
      .single()

    if (profileError || !userProfile) {
      logger(
        'ERROR',
        `Track artwork API: Error fetching admin profile: ${JSON.stringify(profileError)}`
      )
      return NextResponse.json(
        {
          error: 'Failed to get admin credentials',
          code: 'ADMIN_PROFILE_ERROR',
          status: 500
        },
        { status: 500 }
      )
    }

    const typedProfile = userProfile as UserProfile

    // Check if token needs refresh
    const tokenExpiresAt = typedProfile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)
    let accessToken = typedProfile.spotify_access_token

    if (tokenExpiresAt && tokenExpiresAt <= now) {
      // Token is expired, refresh it
      if (!typedProfile.spotify_refresh_token) {
        logger('ERROR', 'Track artwork API: No refresh token available')
        return NextResponse.json(
          {
            error: 'No refresh token available',
            code: 'NO_REFRESH_TOKEN',
            status: 500
          },
          { status: 500 }
        )
      }

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: typedProfile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        logger(
          'ERROR',
          `Track artwork API: Error refreshing token: ${await response.text()}`
        )
        return NextResponse.json(
          {
            error: 'Failed to refresh token',
            code: 'TOKEN_REFRESH_ERROR',
            status: 500
          },
          { status: 500 }
        )
      }

      const tokenData = (await response.json()) as SpotifyTokenResponse
      accessToken = tokenData.access_token

      // Update the token in the database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: tokenData.access_token,
          spotify_token_expires_at:
            Math.floor(Date.now() / 1000) + tokenData.expires_in
        })
        .eq('id', userProfile.id)

      if (updateError) {
        logger(
          'ERROR',
          `Track artwork API: Error updating token in database: ${JSON.stringify(updateError)}`
        )
        // Log error but continue
      }
    }

    if (!accessToken) {
      logger('ERROR', 'Track artwork API: No access token available')
      return NextResponse.json(
        {
          error: 'No access token available',
          code: 'NO_ACCESS_TOKEN',
          status: 500
        },
        { status: 500 }
      )
    }

    logger(
      'INFO',
      'Track artwork API: Got access token, fetching from Spotify API'
    )

    // Fetch track details from Spotify API
    const response = await fetch(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    logger(
      'INFO',
      `Track artwork API: Spotify API response status: ${response.status}`
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger(
        'ERROR',
        `Track artwork API: Spotify API error: ${JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          errorText
        })}`
      )
      return NextResponse.json(
        {
          error: `Failed to fetch track from Spotify: ${response.status} ${response.statusText}`,
          code: 'SPOTIFY_API_ERROR',
          status: response.status
        },
        { status: response.status }
      )
    }

    const trackData = (await response.json()) as {
      id: string
      name: string
      album?: {
        name: string
        images?: Array<{ url: string }>
      }
    }
    logger(
      'INFO',
      `Track artwork API: Track data received: ${JSON.stringify({
        id: trackData.id,
        name: trackData.name,
        album: trackData.album?.name,
        images: trackData.album?.images?.length ?? 0
      })}`
    )

    const artworkUrl = trackData.album?.images?.[0]?.url ?? null

    return NextResponse.json({ artworkUrl })
  } catch (error) {
    logger(
      'ERROR',
      `Track artwork API: Unexpected error: ${JSON.stringify(error)}`
    )
    return NextResponse.json(
      {
        error: 'Failed to fetch track artwork',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
