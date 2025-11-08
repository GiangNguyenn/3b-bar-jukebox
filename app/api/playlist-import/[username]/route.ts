import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'

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

interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
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
      .select('id, spotify_access_token, spotify_refresh_token, spotify_token_expires_at')
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
    let accessToken = profile.spotify_access_token
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
          refresh_token: profile.spotify_refresh_token
        })
      })

      if (!response.ok) {
        logger('ERROR', `Error refreshing token: ${await response.text()}`)
        return NextResponse.json(
          {
            success: 0,
            skipped: 0,
            failed: 0,
            errors: ['Failed to refresh token'],
            total_fetched: 0
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
          spotify_refresh_token:
            tokenData.refresh_token ?? profile.spotify_refresh_token,
          spotify_token_expires_at:
            Math.floor(Date.now() / 1000) + tokenData.expires_in
        })
        .eq('id', profile.id)

      if (updateError) {
        logger('ERROR', 'Failed to update token in database', undefined, updateError)
        // Don't fail the request, just log the error
      }
    }

    const summary: ImportSummary = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      total_fetched: 0
    }

    // Step 1: Fetch all tracks from Spotify (either from playlist or liked songs)
    const source = playlistId ? `playlist ${playlistId}` : 'liked songs'
    
    const allTracks: SpotifyTrack[] = []
    let nextUrl: string | null = playlistId 
      ? `playlists/${playlistId}/tracks?limit=50`
      : 'me/tracks?limit=50'

    while (nextUrl) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response: SpotifySavedTracksResponse | SpotifyPlaylistTracksResponse =
          playlistId
            ? await sendApiRequest<SpotifyPlaylistTracksResponse>({
                path: nextUrl,
                method: 'GET',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                token: accessToken
              })
            : await sendApiRequest<SpotifySavedTracksResponse>({
                path: nextUrl,
                method: 'GET',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                token: accessToken
              })

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!response.items || response.items.length === 0) {
          break
        }

        // Add tracks to our collection (filter out null tracks)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        for (const item of response.items) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (item.track) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
            allTracks.push(item.track)
          }
        }

        // Move to next page
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        nextUrl = response.next
          ? response.next.replace('https://api.spotify.com/v1/', '')
          : null
      } catch (error) {
        logger(
          'ERROR',
          `Error fetching tracks from ${source}`,
          undefined,
          error as Error
        )
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        summary.errors.push(`Failed to fetch tracks from ${source}: ${errorMsg}`)
        break
      }
    }

    summary.total_fetched = allTracks.length

    if (allTracks.length === 0) {
      return NextResponse.json(summary)
    }

    // Step 2: Deduplicate tracks by spotify_track_id
    const uniqueTracks = Array.from(
      new Map(allTracks.map(track => [track.id, track])).values()
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
    let upsertedCount = 0

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
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          upsertedCount += batch.length
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            summary.failed += batch.length
          } else {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          summary.failed += batch.length
        }
      }
    }

    return NextResponse.json(summary)
  } catch (error) {
    logger(
      'ERROR',
      'Error in import playlist route',
      undefined,
      error as Error
    )
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

