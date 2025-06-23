import { NextResponse } from 'next/server'
import { z } from 'zod'
import { songsBetweenRepeatsSchema } from '@/app/[username]/admin/components/track-suggestions/validations/trackSuggestions'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { type Genre } from '@/shared/constants/trackSuggestion'

export const runtime = 'nodejs'

// Configure timeout
export const maxDuration = 60 // 60 seconds

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

export function GET(): NextResponse<{ message: string }> {
  return NextResponse.json({ message: 'Refresh site endpoint is active' })
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
