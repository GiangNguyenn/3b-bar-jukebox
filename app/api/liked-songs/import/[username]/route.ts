import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'

export const maxDuration = 60 // Maximum for Vercel hobby plan
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

    // Step 1: Fetch liked songs from Spotify
    // Limit to 100 tracks to reduce Vercel usage and prevent excessive imports
    const MAX_IMPORT_TRACKS = 100
    const allLikedTracks: SpotifyTrack[] = []
    let nextUrl: string | null = 'me/tracks?limit=50'

    while (nextUrl && allLikedTracks.length < MAX_IMPORT_TRACKS) {
      try {
        const response: SpotifySavedTracksResponse =
          await sendApiRequest<SpotifySavedTracksResponse>({
            path: nextUrl,
            method: 'GET',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            token: profile.spotify_access_token
          })

        if (!response.items || response.items.length === 0) {
          break
        }

        // Add tracks to our collection (filter out null tracks)
        // Stop if we've reached the maximum limit
        for (const item of response.items) {
          if (item.track && allLikedTracks.length < MAX_IMPORT_TRACKS) {
            allLikedTracks.push(item.track)
          }
          if (allLikedTracks.length >= MAX_IMPORT_TRACKS) {
            break
          }
        }

        // Move to next page only if we haven't reached the limit
        if (allLikedTracks.length < MAX_IMPORT_TRACKS) {
          nextUrl = response.next
            ? response.next.replace('https://api.spotify.com/v1/', '')
            : null
        } else {
          nextUrl = null // Stop fetching if we've reached the limit
        }
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

    if (allLikedTracks.length === 0) {
      return NextResponse.json(summary)
    }

    // Step 2: Batch upsert tracks to tracks table
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

    // Step 3: Get track IDs from database by Spotify IDs
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      trackIdMap.set(track.spotify_track_id, track.id)
    })

    // Step 4: Get existing queue track IDs for this user
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
