import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { songsBetweenRepeatsSchema } from '@/app/[username]/admin/components/track-suggestions/validations/trackSuggestions'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { type Genre } from '@/shared/constants/trackSuggestion'

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

// Keep a reference to the service instance
let serviceInstance: PlaylistRefreshServiceImpl | null = null

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
  maxOffset: z.number().min(1).max(10000)
})

interface RefreshResponse {
  success: boolean
  message?: string
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
      const service = PlaylistRefreshServiceImpl.getInstance()
      const track = service.getLastSuggestedTrack()

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
      console.error('[Last Suggested Track] Error:', error)
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
    const body = (await request.json()) as unknown
    const validatedData = refreshRequestSchema.parse(body)

    // Use the cached instance if available, otherwise create a new one
    serviceInstance ??= PlaylistRefreshServiceImpl.getInstance()

    const result = await serviceInstance.refreshPlaylist(true, {
      genres: validatedData.genres,
      yearRange: validatedData.yearRange,
      popularity: validatedData.popularity,
      allowExplicit: validatedData.allowExplicit,
      maxSongLength: validatedData.maxSongLength,
      songsBetweenRepeats: validatedData.songsBetweenRepeats,
      maxOffset: validatedData.maxOffset
    })

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      searchDetails: result.diagnosticInfo as RefreshResponse['searchDetails']
    })
  } catch (error) {
    console.error('[API Refresh Site] Error:', error)

    if (error instanceof z.ZodError) {
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
    console.error('[Last Suggested Track] Error updating cache:', error)
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
