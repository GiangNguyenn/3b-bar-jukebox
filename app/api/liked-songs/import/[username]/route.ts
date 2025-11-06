import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'

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
          errors: [`Profile not found for ${username}`]
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
          errors: ['No Spotify access token available']
        },
        { status: 401 }
      )
    }

    const summary: ImportSummary = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: []
    }

    // Fetch all liked songs with pagination
    let nextUrl: string | null = 'me/tracks?limit=50'
    let totalProcessed = 0

    while (nextUrl) {
      try {
        logger('INFO', `Fetching liked songs from: ${nextUrl}`)

        // Fetch a page of liked songs
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
          `Fetched ${response.items.length} liked songs for ${username} (page ${Math.floor(totalProcessed / 50) + 1}), total: ${response.total}`
        )

        // If no items, break out of loop
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!response.items || response.items.length === 0) {
          logger('INFO', 'No more liked songs to process')
          break
        }

        // Process each track in this page
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        for (const item of response.items) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          const track = item.track

          // Skip if track is null (can happen with unavailable tracks)
          if (!track) {
            logger('WARN', 'Skipping null track')
            continue
          }

          totalProcessed++

          try {
            // Call the existing playlist API to add the track
            // Use full URL to ensure it resolves correctly in API routes
            const baseUrl =
              process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
            const addResponse = await fetch(
              `${baseUrl}/api/playlist/${username}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  tracks: {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    id: track.id,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    name: track.name,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    artists: track.artists,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    album: track.album,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    duration_ms: track.duration_ms,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    popularity: track.popularity,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    uri: track.uri
                  },
                  initialVotes: 1,
                  source: 'admin'
                })
              }
            )

            if (addResponse.ok) {
              summary.success++
            } else if (addResponse.status === 409) {
              // Track already in playlist - skip silently
              summary.skipped++
            } else {
              summary.failed++
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const errorData = await addResponse.json()
              const errorMessage =
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                typeof errorData === 'object' && 'error' in errorData
                  ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    String(errorData.error)
                  : 'Unknown error'
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              summary.errors.push(`${track.name}: ${errorMessage}`)
              logger(
                'WARN',
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                `Failed to add track ${track.name}: ${errorMessage}`
              )
            }
          } catch (error) {
            summary.failed++
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error'
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            summary.errors.push(`${track.name}: ${errorMessage}`)
            logger(
              'ERROR',
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              `Error adding track ${track.name}`,
              undefined,
              error as Error
            )
          }
        }

        // Move to next page or stop
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
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
        logger('ERROR', `Fetch error details: ${errorMsg}`)
        summary.errors.push(`Failed to fetch liked songs: ${errorMsg}`)
        break // Stop pagination on error
      }
    }

    logger(
      'INFO',
      `Import summary - Total processed: ${totalProcessed}, Success: ${summary.success}, Skipped: ${summary.skipped}, Failed: ${summary.failed}`
    )

    logger(
      'INFO',
      `Import complete for ${username}: ${summary.success} added, ${summary.skipped} skipped, ${summary.failed} failed`
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
        ]
      },
      { status: 500 }
    )
  }
}
