import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { z } from 'zod'
import { songsBetweenRepeatsSchema } from '@/app/admin/components/track-suggestions/validations/trackSuggestions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Configure timeout
export const maxDuration = 60 // 60 seconds

const refreshRequestSchema = z
  .object({
    genres: z
      .array(z.string().trim().min(1, 'Genre names cannot be empty'))
      .min(1, 'At least one genre is required')
      .transform((genres) => genres.map((g) => g.toLowerCase())), // Normalize genres

    yearRange: z
      .tuple([
        z
          .number()
          .int('Start year must be an integer')
          .min(1900, 'Start year must be at least 1900'),
        z
          .number()
          .int('End year must be an integer')
          .max(new Date().getFullYear(), 'End year cannot be in the future')
      ])
      .refine(([start, end]) => start <= end, {
        message: 'Start year must be less than or equal to end year'
      }),

    popularity: z
      .number()
      .int('Popularity must be an integer')
      .min(0, 'Popularity must be at least 0')
      .max(100, 'Popularity cannot exceed 100'),

    allowExplicit: z.boolean().default(false), // Provide a default value

    maxSongLength: z
      .number()
      .int('Song length must be an integer')
      .min(3, 'Maximum song length must be at least 3 minutes')
      .max(20, 'Maximum song length cannot exceed 20 minutes')
      .transform((val) => Math.floor(val)), // Ensure integer values

    songsBetweenRepeats: songsBetweenRepeatsSchema
  })
  .strict()

interface RefreshResponse {
  success: boolean
  message?: string
  playerStateRefresh?: boolean
  errors?: Array<{ field: string; message: string }>
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

    const service = PlaylistRefreshServiceImpl.getInstance()
    const result = await service.refreshPlaylist(false, validatedData)

    return NextResponse.json({
      success: true,
      message: result.message,
      playerStateRefresh: result.playerStateRefresh
    })
  } catch (error) {
    console.error('[Refresh Site] Error:', error)

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
    
    // Ensure we always return valid JSON
    return NextResponse.json(
      {
        success: false,
        message: errorMessage
      },
      {
        status: error instanceof Error && error.message.includes('timeout') ? 504 : 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}
