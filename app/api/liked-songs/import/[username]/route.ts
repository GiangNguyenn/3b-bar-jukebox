import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'

export const maxDuration = 300 // 5 minutes for large imports
export const dynamic = 'force-dynamic'

const logger = createModuleLogger('API Liked Songs Import')

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

interface SpotifySavedTracksResponse {
  items: SpotifySavedTrack[]
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

    // Get the logged-in user's profile to verify authentication
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, spotify_access_token')
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

    const summary: ImportSummary = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      total_fetched: 0
    }

    // Step 1: Fetch all liked songs from Spotify
    logger('INFO', `Starting to fetch all liked songs for ${username}`)
    const allLikedTracks: SpotifyTrack[] = []
    let nextUrl: string | null = 'me/tracks?limit=50'

    while (nextUrl) {
      try {
        logger('INFO', `Fetching liked songs from: ${nextUrl}`)

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response: SpotifySavedTracksResponse =
          await sendApiRequest<SpotifySavedTracksResponse>({
            path: nextUrl,
            method: 'GET',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            token: profile.spotify_access_token
          })

        logger(
          'INFO',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          `Fetched ${response.items.length} liked songs (total so far: ${allLikedTracks.length + response.items.length})`
        )

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
            allLikedTracks.push(item.track)
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
          'Error fetching liked songs page',
          undefined,
          error as Error
        )
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        summary.errors.push(`Failed to fetch liked songs: ${errorMsg}`)
        break
      }
    }

    summary.total_fetched = allLikedTracks.length
    logger(
      'INFO',
      `Finished fetching. Total liked songs: ${allLikedTracks.length}`
    )

    if (allLikedTracks.length === 0) {
      return NextResponse.json(summary)
    }

    // Step 2: Batch upsert tracks to tracks table
    logger('INFO', 'Starting batch upsert of tracks')
    const trackRecords = allLikedTracks.map((track) => ({
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

    for (const [index, batch] of trackBatches.entries()) {
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
          upsertedCount += batch.length
          logger(
            'INFO',
            `Upserted batch ${index + 1}/${trackBatches.length} (${batch.length} tracks)`
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

    logger('INFO', `Upserted ${upsertedCount} tracks to database`)

    // Step 3: Get track IDs from database by Spotify IDs
    logger('INFO', 'Fetching track IDs from database')
    const spotifyTrackIds = allLikedTracks.map((track) => track.id)
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
      trackIdMap.set(track.spotify_track_id, track.id)
    })

    logger('INFO', `Mapped ${trackIdMap.size} tracks from database`)

    // Step 4: Get existing queue track IDs for this user
    logger('INFO', 'Fetching existing queue tracks')
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
      existingQueue?.map((item) => item.track_id) || []
    )
    logger('INFO', `Found ${existingTrackIds.size} tracks already in queue`)

    // Step 5: Filter out tracks already in queue and prepare queue items
    const queueItems = []
    for (const track of allLikedTracks) {
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
          profile_id: profile.id,
          track_id: trackId,
          votes: 1
        })
      }
    }

    logger(
      'INFO',
      `Prepared ${queueItems.length} new tracks to add to queue (${summary.skipped} already in queue)`
    )

    // Step 6: Batch insert to jukebox_queue
    if (queueItems.length > 0) {
      const queueBatches = chunkArray(queueItems, 50)

      for (const [index, batch] of queueBatches.entries()) {
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
            logger(
              'INFO',
              `Inserted queue batch ${index + 1}/${queueBatches.length} (${batch.length} tracks)`
            )
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

    logger(
      'INFO',
      `Import complete for ${username}: ${summary.success} added, ${summary.skipped} skipped, ${summary.failed} failed (${summary.total_fetched} total fetched)`
    )

    return NextResponse.json(summary)
  } catch (error) {
    logger(
      'ERROR',
      'Error in import liked songs route',
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
