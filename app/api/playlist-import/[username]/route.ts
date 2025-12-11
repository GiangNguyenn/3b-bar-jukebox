import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'
import { refreshTokenWithRetry } from '@/recovery/tokenRecovery'
import { updateTokenInDatabase } from '@/recovery/tokenDatabaseUpdate'

export const maxDuration = 60 // Maximum for Vercel hobby plan
export const dynamic = 'force-dynamic'

const logger = createModuleLogger('API Playlist Import')

interface SpotifyTrack {
  id: string
  name: string
  artists: Array<{ name: string; id: string }>
  album: {
    name: string
    images: Array<{ url: string }>
  }
  duration_ms: number
  popularity: number
  uri: string
}

interface SpotifySavedTrack {
  added_at: string
  track: SpotifyTrack
}

interface SpotifyPlaylistTrack {
  added_at: string
  track: SpotifyTrack
}

interface SpotifySavedTracksResponse {
  items: SpotifySavedTrack[]
  next: string | null
  total: number
}

interface SpotifyPlaylistTracksResponse {
  items: SpotifyPlaylistTrack[]
  next: string | null
  total: number
}

interface ImportSummary {
  success: number
  skipped: number
  failed: number
  errors: string[]
  total_fetched: number
}

interface ImportRequest {
  playlistId?: string | null
}

// Helper function to chunk arrays
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

export async function POST(
  request: Request,
  { params }: { params: { username: string } }
): Promise<NextResponse<ImportSummary>> {
  try {
    const username = params.username

    // Parse request body to get playlist ID
    const body = (await request.json()) as ImportRequest
    const playlistId = body.playlistId

    // Get the user's profile to verify authentication
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
        {
          success: 0,
          skipped: 0,
          failed: 0,
          errors: [`Profile not found for ${username}`],
          total_fetched: 0
        },
        { status: 404 }
      )
    }

    if (!profile.spotify_access_token) {
      logger('ERROR', `No Spotify access token for user: ${username}`)
      return NextResponse.json(
        {
          success: 0,
          skipped: 0,
          failed: 0,
          errors: ['No Spotify access token available'],
          total_fetched: 0
        },
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
          {
            success: 0,
            skipped: 0,
            failed: 0,
            errors: ['No refresh token available'],
            total_fetched: 0
          },
          { status: 500 }
        )
      }

      const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
      const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        logger('ERROR', 'Missing Spotify credentials')
        return NextResponse.json(
          {
            success: 0,
            skipped: 0,
            failed: 0,
            errors: ['Server configuration error'],
            total_fetched: 0
          },
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
          {
            success: 0,
            skipped: 0,
            failed: 0,
            errors: [errorMessage],
            total_fetched: 0
          },
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
          {
            success: 0,
            skipped: 0,
            failed: 0,
            errors: [errorMessage],
            total_fetched: 0
          },
          { status: updateResult.error?.isRecoverable ? 503 : 500 }
        )
      }
    }

    const summary: ImportSummary = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      total_fetched: 0
    }

    // Step 1: Fetch tracks from Spotify (either from playlist or liked songs)
    // Limit to 100 tracks to reduce Vercel usage and prevent excessive imports
    const MAX_IMPORT_TRACKS = 100
    const source = playlistId ? `playlist ${playlistId}` : 'liked songs'

    const allTracks: SpotifyTrack[] = []
    let nextUrl: string | null = playlistId
      ? `playlists/${playlistId}/tracks?limit=50`
      : 'me/tracks?limit=50'

    while (nextUrl && allTracks.length < MAX_IMPORT_TRACKS) {
      try {
        const response:
          | SpotifySavedTracksResponse
          | SpotifyPlaylistTracksResponse = playlistId
          ? await sendApiRequest<SpotifyPlaylistTracksResponse>({
              path: nextUrl,
              method: 'GET',
              token: accessToken
            })
          : await sendApiRequest<SpotifySavedTracksResponse>({
              path: nextUrl,
              method: 'GET',
              token: accessToken
            })

        if (!response.items || response.items.length === 0) {
          break
        }

        // Add tracks to our collection (filter out null tracks)
        // Stop if we've reached the maximum limit
        for (const item of response.items) {
          if (item.track && allTracks.length < MAX_IMPORT_TRACKS) {
            allTracks.push(item.track)
          }
          if (allTracks.length >= MAX_IMPORT_TRACKS) {
            break
          }
        }

        // Move to next page only if we haven't reached the limit
        if (allTracks.length < MAX_IMPORT_TRACKS) {
          nextUrl = response.next
            ? response.next.replace('https://api.spotify.com/v1/', '')
            : null
        } else {
          nextUrl = null // Stop fetching if we've reached the limit
        }
      } catch (error) {
        logger(
          'ERROR',
          `Error fetching tracks from ${source}`,
          undefined,
          error as Error
        )
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        summary.errors.push(
          `Failed to fetch tracks from ${source}: ${errorMsg}`
        )
        break
      }
    }

    summary.total_fetched = allTracks.length

    if (allTracks.length === 0) {
      return NextResponse.json(summary)
    }

    // Step 2: Deduplicate tracks by spotify_track_id
    const uniqueTracks = Array.from(
      new Map(allTracks.map((track) => [track.id, track])).values()
    )

    // Step 3: Batch upsert tracks to tracks table
    const trackRecords = uniqueTracks.map((track) => ({
      spotify_track_id: track.id,
      name: track.name,
      artist: track.artists[0]?.name || 'Unknown Artist',
      album: track.album.name,
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      spotify_url: track.uri,
      genre: null, // Skip for performance
      release_year: null // Skip for performance
    }))

    // Upsert in batches of 50 (Supabase limit)
    const trackBatches = chunkArray(trackRecords, 50)

    for (let index = 0; index < trackBatches.length; index++) {
      const batch = trackBatches[index]
      try {
        const { error: upsertError } = await supabase
          .from('tracks')
          .upsert(batch, { onConflict: 'spotify_track_id' })

        if (upsertError) {
          logger(
            'ERROR',
            `Error upserting batch ${index + 1}/${trackBatches.length}`,
            undefined,
            upsertError as Error
          )
          summary.errors.push(
            `Failed to upsert tracks batch ${index + 1}: ${upsertError.message}`
          )
        }
      } catch (error) {
        logger(
          'ERROR',
          `Exception upserting batch ${index + 1}`,
          undefined,
          error as Error
        )
        summary.errors.push(
          `Failed to upsert tracks batch ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    // Step 4: Get track IDs from database by Spotify IDs
    const spotifyTrackIds = uniqueTracks.map((track) => track.id)
    const { data: dbTracks, error: fetchError } = await supabase
      .from('tracks')
      .select('id, spotify_track_id')
      .in('spotify_track_id', spotifyTrackIds)

    if (fetchError) {
      logger('ERROR', 'Failed to fetch track IDs', undefined, fetchError)
      summary.errors.push(`Failed to fetch track IDs: ${fetchError.message}`)
      return NextResponse.json(summary, { status: 500 })
    }

    // Create a map of spotify_track_id -> database id
    const trackIdMap = new Map<string, string>()
    dbTracks?.forEach((track) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      trackIdMap.set(track.spotify_track_id, track.id)
    })

    // Step 5: Get existing queue track IDs for this user
    const { data: existingQueue, error: queueFetchError } = await supabase
      .from('jukebox_queue')
      .select('track_id')
      .eq('profile_id', profile.id)

    if (queueFetchError) {
      logger(
        'ERROR',
        'Failed to fetch existing queue',
        undefined,
        queueFetchError
      )
      summary.errors.push(
        `Failed to fetch existing queue: ${queueFetchError.message}`
      )
      return NextResponse.json(summary, { status: 500 })
    }

    const existingTrackIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
      existingQueue?.map((item) => item.track_id) || []
    )

    // Step 6: Filter out tracks already in queue and prepare queue items
    const queueItems = []
    for (const track of uniqueTracks) {
      const trackId = trackIdMap.get(track.id)
      if (!trackId) {
        logger('WARN', `Track ${track.name} not found in database, skipping`)
        summary.failed++
        continue
      }

      if (existingTrackIds.has(trackId)) {
        summary.skipped++
      } else {
        queueItems.push({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          profile_id: profile.id,
          track_id: trackId,
          votes: 1
        })
      }
    }

    // Step 7: Batch insert to jukebox_queue
    if (queueItems.length > 0) {
      const queueBatches = chunkArray(queueItems, 50)

      for (let index = 0; index < queueBatches.length; index++) {
        const batch = queueBatches[index]
        try {
          const { error: insertError } = await supabase
            .from('jukebox_queue')
            .insert(batch)

          if (insertError) {
            logger(
              'ERROR',
              `Error inserting queue batch ${index + 1}/${queueBatches.length}`,
              undefined,
              insertError as Error
            )
            summary.errors.push(
              `Failed to insert queue batch ${index + 1}: ${insertError.message}`
            )
            summary.failed += batch.length
          } else {
            summary.success += batch.length
          }
        } catch (error) {
          logger(
            'ERROR',
            `Exception inserting queue batch ${index + 1}`,
            undefined,
            error as Error
          )
          summary.errors.push(
            `Failed to insert queue batch ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
          summary.failed += batch.length
        }
      }
    }

    return NextResponse.json(summary)
  } catch (error) {
    logger('ERROR', 'Error in import playlist route', undefined, error as Error)
    return NextResponse.json(
      {
        success: 0,
        skipped: 0,
        failed: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred'
        ],
        total_fetched: 0
      },
      { status: 500 }
    )
  }
}
