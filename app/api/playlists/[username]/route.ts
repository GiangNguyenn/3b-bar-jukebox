import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const logger = createModuleLogger('API Playlists')

interface SpotifyPlaylistSimplified {
  id: string
  name: string
  tracks: {
    total: number
  }
  images: Array<{ url: string }>
  public: boolean
  owner: {
    display_name: string
  }
}

interface SpotifyPlaylistsResponse {
  items: SpotifyPlaylistSimplified[]
  next: string | null
  total: number
}

interface PlaylistListItem {
  id: string
  name: string
  trackCount: number
  imageUrl: string | null
  isPublic: boolean
  ownerName: string
}

export async function GET(
  request: Request,
  { params }: { params: { username: string } }
): Promise<NextResponse> {
  try {
    const username = params.username

    // Get the user's profile to get their Spotify access token
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
      )
      .ilike('display_name', username)
      .single()

    if (profileError || !profile) {
      logger(
        'ERROR',
        `Failed to fetch profile for username: ${username}`,
        undefined,
        profileError || new Error('No profile returned')
      )
      return NextResponse.json(
        { error: `Profile not found for ${username}` },
        { status: 404 }
      )
    }

    if (!profile.spotify_access_token) {
      logger('ERROR', `No Spotify access token for user: ${username}`)
      return NextResponse.json(
        { error: 'No Spotify access token available' },
        { status: 401 }
      )
    }

    // Check if token needs refresh
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let accessToken: string = profile.spotify_access_token
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const tokenExpiresAt = profile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)

    if (tokenExpiresAt && tokenExpiresAt <= now) {
      // Token is expired, refresh it
      if (!profile.spotify_refresh_token) {
        logger('ERROR', 'No refresh token available')
        return NextResponse.json(
          { error: 'No refresh token available' },
          { status: 500 }
        )
      }

      const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
      const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        logger('ERROR', 'Missing Spotify credentials')
        return NextResponse.json(
          { error: 'Server configuration error' },
          { status: 500 }
        )
      }

      // Use recovery module for token refresh with retry logic
      // We already checked that spotify_refresh_token is not null above
      const refreshResult = await refreshTokenWithRetry(
        profile.spotify_refresh_token,
        SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET
      )

      if (!refreshResult.success || !refreshResult.accessToken) {
        const errorCode = refreshResult.error?.code ?? 'TOKEN_REFRESH_ERROR'
        const errorMessage =
          refreshResult.error?.message ?? 'Failed to refresh token'

        logger('ERROR', `Token refresh failed: ${errorCode} - ${errorMessage}`)

        return NextResponse.json(
          { error: errorMessage },
          { status: refreshResult.error?.isRecoverable ? 503 : 500 }
        )
      }

      accessToken = refreshResult.accessToken

      // Update the token in the database with retry logic
      // This is critical - if database update fails, we should not use the token
      const updateResult = await updateTokenInDatabase(
        supabase,
        String(profile.id),
        {
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken,
          expiresIn: refreshResult.expiresIn,
          currentRefreshToken: profile.spotify_refresh_token
        }
      )

      if (!updateResult.success) {
        const errorCode = updateResult.error?.code ?? 'DATABASE_UPDATE_ERROR'
        const errorMessage =
          updateResult.error?.message ?? 'Failed to update token in database'

        logger(
          'ERROR',
          `Token refresh succeeded but database update failed: ${errorCode} - ${errorMessage}`
        )

        // Return error - don't proceed with request if we can't persist token
        return NextResponse.json(
          { error: errorMessage },
          { status: updateResult.error?.isRecoverable ? 503 : 500 }
        )
      }
    }

    // Fetch all playlists from Spotify (with pagination)
    const allPlaylists: PlaylistListItem[] = []
    let nextUrl: string | null = 'me/playlists?limit=50'

    while (nextUrl) {
      try {
        const response: SpotifyPlaylistsResponse =
          await sendApiRequest<SpotifyPlaylistsResponse>({
            path: nextUrl,
            method: 'GET',
            token: accessToken
          })

        // Transform the Spotify playlists into our simplified format
        const transformedPlaylists = response.items.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          trackCount: playlist.tracks.total,
          imageUrl: playlist.images?.[0]?.url ?? null,
          isPublic: playlist.public,
          ownerName: playlist.owner.display_name
        }))

        allPlaylists.push(...transformedPlaylists)

        // Update nextUrl for pagination
        if (response.next) {
          // Extract just the path from the full URL
          const url = new URL(response.next)
          nextUrl = url.pathname.replace('/v1/', '') + url.search
        } else {
          nextUrl = null
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        logger(
          'ERROR',
          `Failed to fetch playlists page: ${errorMessage}`,
          undefined,
          err instanceof Error ? err : new Error(String(err))
        )
        return NextResponse.json(
          { error: `Failed to fetch playlists from Spotify: ${errorMessage}` },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ playlists: allPlaylists })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger(
      'ERROR',
      `Unexpected error in GET playlists handler: ${errorMessage}`,
      undefined,
      error as Error
    )
    return NextResponse.json(
      { error: `An unexpected error occurred: ${errorMessage}` },
      { status: 500 }
    )
  }
}
