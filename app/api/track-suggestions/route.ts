import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { songsBetweenRepeatsSchema } from '@/app/[username]/admin/components/track-suggestions/validations/trackSuggestions'
import { findSuggestedTrack } from '@/services/trackSuggestion'
import { type Genre } from '@/shared/constants/trackSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Track Suggestions')

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds

// Define the type for the last suggested track
interface LastSuggestedTrack {
  name: string
  artist: string
  album: string
  uri: string
  popularity: number
  duration_ms: number
  preview_url: string | null
  genres: string[]
}

// Server-side cache for the last suggested track
let serverCache: LastSuggestedTrack | null = null

const refreshRequestSchema = z.object({
  genres: z
    .array(z.string() as z.ZodType<Genre>)
    .min(1)
    .max(10),
  yearRange: z.tuple([
    z.number().min(1900),
    z.number().max(new Date().getFullYear())
  ]),
  popularity: z.number().min(0).max(100),
  allowExplicit: z.boolean(),
  maxSongLength: z.number().min(3).max(20), // In minutes
  songsBetweenRepeats: songsBetweenRepeatsSchema,
  maxOffset: z.number().min(1).max(10000),
  excludedTrackIds: z.array(z.string()).optional() // Optional array of track IDs to exclude
})

interface RefreshResponse {
  success: boolean
  message?: string
  tracks?: Array<{ id: string }>
  searchDetails?: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails: Array<{
      name: string
      popularity: number
      isExcluded: boolean
      isPlayable: boolean
      duration_ms: number
      explicit: boolean
    }>
  }
}

export function GET(request: NextRequest): NextResponse {
  const { searchParams } = new URL(request.url)
  const latest = searchParams.get('latest')

  if (latest === 'true') {
    try {
      // If we have a cached track, return it immediately
      if (serverCache) {
        return NextResponse.json({
          success: true,
          track: serverCache,
          hasServerCache: true,
          timestamp: Date.now()
        })
      }

      // Otherwise, get the track from the service
      // For now, return null since we're not using the service anymore
      const track = null

      // Update server cache if we got a track
      if (track) {
        serverCache = track
      }

      return NextResponse.json({
        success: true,
        track: track ?? null,
        hasServerCache: !!serverCache,
        timestamp: Date.now()
      })
    } catch (error) {
      logger('ERROR', `[Last Suggested Track] Error: ${JSON.stringify(error)}`)
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        },
        { status: 500 }
      )
    }
  }

  // Default health check
  return NextResponse.json({ message: 'Track suggestions endpoint is active' })
}

export async function POST(
  request: Request
): Promise<NextResponse<RefreshResponse>> {
  try {
    logger('INFO', '[Track Suggestions API] Starting POST request')

    const body = (await request.json()) as unknown

    logger(
      'INFO',
      `[Track Suggestions API] Request body: ${JSON.stringify(body)}`
    )

    const validatedData = refreshRequestSchema.parse(body)
    logger(
      'INFO',
      `[Track Suggestions API] Validated data: ${JSON.stringify(validatedData)}`
    )

    // Use findSuggestedTrack with app tokens for server-side operation
    logger('INFO', '[Track Suggestions API] Calling findSuggestedTrack...')
    const result = await findSuggestedTrack(
      validatedData.excludedTrackIds ?? [], // Use validated excludedTrackIds
      null, // No current track ID
      'US', // Default market
      {
        genres: validatedData.genres,
        yearRange: validatedData.yearRange,
        popularity: validatedData.popularity,
        allowExplicit: validatedData.allowExplicit,
        maxSongLength: validatedData.maxSongLength,
        songsBetweenRepeats: validatedData.songsBetweenRepeats,
        maxOffset: validatedData.maxOffset
      },
      true // Use app token for server-side operations
    )

    logger(
      'INFO',
      `[Track Suggestions API] findSuggestedTrack result: ${JSON.stringify({
        trackFound: !!result.track,
        trackId: result.track?.id,
        trackName: result.track?.name,
        attempts: result.searchDetails.attempts,
        totalTracksFound: result.searchDetails.totalTracksFound,
        genresTried: result.searchDetails.genresTried
      })}`
    )

    if (!result.track) {
      logger(
        'ERROR',
        `[Track Suggestions API] No suitable track found after ${result.searchDetails.attempts} attempts`
      )
      logger(
        'ERROR',
        `[Track Suggestions API] Search details: ${JSON.stringify(result.searchDetails)}`
      )

      return NextResponse.json(
        {
          success: false,
          message: 'No suitable track found'
        },
        { status: 400 }
      )
    }

    logger(
      'INFO',
      `[Track Suggestions API] Successfully found track: ${result.track.name} by ${result.track.artists.map((a) => a.name).join(', ')}`
    )

    return NextResponse.json({
      success: true,
      message: 'Track suggestion found successfully',
      tracks: [
        {
          id: result.track.id
        }
      ],
      searchDetails: result.searchDetails as RefreshResponse['searchDetails']
    })
  } catch (error) {
    logger('ERROR', `[Track Suggestions API] Error: ${JSON.stringify(error)}`)

    if (error instanceof z.ZodError) {
      logger(
        'ERROR',
        `[Track Suggestions API] Validation error: ${JSON.stringify(error.errors)}`
      )
      return NextResponse.json(
        {
          success: false,
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message
          }))
        },
        { status: 400 }
      )
    }

    const errorMessage =
      error instanceof Error ? error.message : 'An error occurred'

    logger(
      'ERROR',
      `[Track Suggestions API] Final error response: ${errorMessage}`
    )

    return NextResponse.json(
      {
        success: false,
        message: errorMessage
      },
      {
        status:
          error instanceof Error && error.message.includes('timeout')
            ? 504
            : 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}

// PUT endpoint to update the server cache for the last suggested track
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const track = (await request.json()) as LastSuggestedTrack
    serverCache = track

    return NextResponse.json({
      success: true,
      track,
      hasServerCache: true,
      timestamp: Date.now()
    })
  } catch (error) {
    logger(
      'ERROR',
      `[Last Suggested Track] Error updating cache: ${JSON.stringify(error)}`
    )
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      },
      { status: 500 }
    )
  }
}
