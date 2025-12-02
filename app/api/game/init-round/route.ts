import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { getRelatedArtistsForGame, getGameOptionTracks, chooseTargetArtists, getCurrentArtistId } from '@/services/gameService'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'
import { queryWithRetry } from '@/lib/supabase'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

/**
 * POST /api/game/init-round
 * Server-side endpoint to initialize a game round
 * Returns target artists and game option tracks based on the current playing track
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { playbackState: SpotifyPlaybackState }
    const { playbackState } = body

    if (!playbackState) {
      return NextResponse.json(
        { error: 'Playback state is required' },
        { status: 400 }
      )
    }

    // Get admin profile for Spotify API access (same pattern as playlist route)
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

    const adminResult = await queryWithRetry<{
      id: string
      spotify_access_token: string | null
      spotify_refresh_token: string | null
      spotify_token_expires_at: number | null
    }>(
      supabase
        .from('profiles')
        .select(
          'id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at'
        )
        .ilike('display_name', '3B')
        .single(),
      undefined,
      'Fetch admin profile for Spotify API access'
    )

    const adminProfile = adminResult.data
    const adminError = adminResult.error

    if (adminError || !adminProfile?.spotify_access_token) {
      console.error('[API] /api/game/init-round: Failed to get admin token', {
        error: adminError
      })
      return NextResponse.json(
        { error: 'Failed to get admin credentials for Spotify API' },
        { status: 500 }
      )
    }

    // Check if token needs refresh
    const tokenExpiresAt = adminProfile.spotify_token_expires_at
    const now = Math.floor(Date.now() / 1000)
    let accessToken = adminProfile.spotify_access_token

    if (tokenExpiresAt && tokenExpiresAt <= now && adminProfile.spotify_refresh_token) {
      const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
      const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        return NextResponse.json(
          { error: 'Server configuration error' },
          { status: 500 }
        )
      }

      const refreshResult = await refreshTokenWithRetry(
        adminProfile.spotify_refresh_token,
        SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET
      )

      if (!refreshResult.success || !refreshResult.accessToken) {
        return NextResponse.json(
          { error: 'Failed to refresh admin token' },
          { status: 500 }
        )
      }

      accessToken = refreshResult.accessToken

      // Update token in database
      await updateTokenInDatabase(
        supabase,
        adminProfile.id,
        {
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken,
          expiresIn: refreshResult.expiresIn,
          currentRefreshToken: adminProfile.spotify_refresh_token
        }
      )
    }

    const artistId = getCurrentArtistId(playbackState)
    if (!artistId || artistId.trim() === '') {
      console.error('[API] /api/game/init-round: No artist ID found in playback state', {
        hasItem: !!playbackState.item,
        itemId: playbackState.item?.id,
        itemName: playbackState.item?.name,
        artists: playbackState.item?.artists?.map(a => ({ id: a.id, name: a.name }))
      })
      return NextResponse.json(
        { error: 'No primary artist found for the current track' },
        { status: 400 }
      )
    }

    console.log('[API] /api/game/init-round: Fetching related artists', {
      artistId,
      artistIdLength: artistId.length,
      trackName: playbackState.item?.name,
      trackArtists: playbackState.item?.artists?.map(a => ({ name: a.name, id: a.id })).join(', '),
      allArtists: JSON.stringify(playbackState.item?.artists, null, 2)
    })

    // Validate artist ID format (Spotify IDs are alphanumeric, typically 22 characters)
    if (!/^[a-zA-Z0-9]+$/.test(artistId)) {
      console.error('[API] /api/game/init-round: Invalid artist ID format', {
        artistId,
        length: artistId.length,
        trackName: playbackState.item?.name
      })
      return NextResponse.json(
        { error: `Invalid artist ID format: ${artistId}` },
        { status: 400 }
      )
    }

    // Fetch related artists for game options using admin user token
    console.log('[API] /api/game/init-round: Using admin token for related artists', {
      hasToken: !!accessToken,
      tokenLength: accessToken?.length,
      tokenPrefix: accessToken?.substring(0, 20) + '...'
    })
    let relatedArtists: Awaited<ReturnType<typeof getRelatedArtistsForGame>>
    try {
      relatedArtists = await getRelatedArtistsForGame(artistId, accessToken)
    } catch (error) {
      console.error('[API] /api/game/init-round: Error fetching related artists:', {
        artistId,
        error: error instanceof Error ? error.message : String(error),
        errorType: error?.constructor?.name,
        fullError: error
      })
      // If we can't get related artists, return an error but with more context
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json(
        { 
          error: `Unable to fetch related artists for artist "${playbackState.item?.artists?.[0]?.name || artistId}": ${errorMessage}. The artist may not exist or may not have related artists in Spotify's database.` 
        },
        { status: 404 }
      )
    }

    if (!relatedArtists.length) {
      console.error('[API] /api/game/init-round: No related artists found for artistId:', artistId)
      return NextResponse.json(
        { error: 'Unable to find related artists for this track. The artist may not have related artists in Spotify\'s database.' },
        { status: 404 }
      )
    }

    console.log('[API] /api/game/init-round: Found', relatedArtists.length, 'related artists')

    // Choose target artists from curated list
    const targetArtists = chooseTargetArtists()

    // Get game option tracks using admin user token
    const optionTracks = await getGameOptionTracks(relatedArtists, accessToken)

    console.log('[API] /api/game/init-round: Successfully initialized round with', optionTracks.length, 'option tracks')

    return NextResponse.json({
      targetArtists,
      optionTracks
    })
  } catch (error) {
    console.error('[API] /api/game/init-round error:', error)
    console.error('[API] /api/game/init-round error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    })
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'error' in error
          ? String(error.error)
          : 'Failed to initialize game round'
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

