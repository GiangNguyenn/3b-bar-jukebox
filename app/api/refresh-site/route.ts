import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { z } from 'zod'
import { songsBetweenRepeatsSchema } from '@/shared/validations/trackSuggestions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Set a timeout of 55 seconds (Vercel's default timeout is 30s)
// Using 55s to ensure we have time to handle the timeout before Vercel's timeout
const TIMEOUT_MS = 55000

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
  .refine((data) => data.yearRange[0] <= data.yearRange[1], {
    message: 'Start year must be before or equal to end year',
    path: ['yearRange']
  })

type RefreshRequestType = z.infer<typeof refreshRequestSchema>

interface RefreshResponse {
  success: boolean
  message?: string
  playerStateRefresh?: boolean
  errors?: Array<{ field: string; message: string }>
}

export function GET(): NextResponse<{ message: string }> {
  return NextResponse.json({ message: 'GET handler is working' })
}

export async function POST(
  request: Request
): Promise<NextResponse<RefreshResponse>> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)

  try {
    const body = (await request.json()) as RefreshRequestType
    console.log(
      '[Refresh Site] Raw request body:',
      JSON.stringify(body, null, 2)
    )

    const validationResult = refreshRequestSchema.safeParse(body)
    console.log('[Refresh Site] Validation result:', validationResult)

    if (!validationResult.success) {
      const formattedErrors = validationResult.error.format()
      console.error(
        '[Refresh Site] Validation errors:',
        JSON.stringify(formattedErrors, null, 2)
      )

      // Get the first error message for each field
      const errorMessages = validationResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message
      }))

      return NextResponse.json(
        {
          success: false,
          message: 'Invalid request parameters',
          errors: errorMessages
        },
        { status: 400 }
      )
    }

    const {
      genres,
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats
    } = validationResult.data

    console.log('[Refresh Site] Validated data:', {
      genres,
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats
    })

    const trackSuggestionsState = {
      genres,
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats
    }

    const refreshPromise = PlaylistRefreshServiceImpl.getInstance()
      .refreshPlaylist(false, trackSuggestionsState)
      .catch((error) => {
        console.error('[Refresh Site] Playlist refresh error:', error)
        throw error
      })

    const result = await Promise.race([
      refreshPromise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Request timed out'))
        })
      })
    ])

    return NextResponse.json({
      success: result.success,
      message: result.message,
      playerStateRefresh: result.playerStateRefresh ?? false
    })
  } catch (error) {
    console.error('[Refresh Site] Error:', error)

    // Handle timeout specifically
    if (error instanceof Error && error.message === 'Request timed out') {
      return NextResponse.json(
        {
          success: false,
          message: 'Request timed out. The operation took too long to complete. Please try again.',
          error: {
            type: 'timeout',
            message: 'The playlist refresh operation exceeded the maximum allowed time',
            timeoutMs: TIMEOUT_MS
          }
        },
        { status: 504 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to refresh site',
        error: {
          type: 'internal',
          message: error instanceof Error ? error.message : 'An unknown error occurred'
        }
      },
      { status: 500 }
    )
  } finally {
    clearTimeout(timeoutId)
  }
}
