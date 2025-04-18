import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Set a timeout of 60 seconds (Vercel's default timeout is 30s)
const TIMEOUT_MS = 60000

const refreshRequestSchema = z.object({
  genres: z.array(z.string()).min(1, 'At least one genre is required'),
  yearRange: z.tuple([
    z.number().min(1900, 'Start year must be at least 1900'),
    z.number().max(new Date().getFullYear(), 'End year cannot be in the future')
  ]),
  popularity: z
    .number()
    .min(0, 'Popularity must be at least 0')
    .max(100, 'Popularity cannot exceed 100'),
  allowExplicit: z.boolean(),
  maxSongLength: z
    .number()
    .min(3, 'Maximum song length must be at least 3 minutes')
    .max(20, 'Maximum song length cannot exceed 20 minutes'),
  songsBetweenRepeats: z
    .number()
    .min(2, 'Songs between repeats must be at least 2')
    .max(50, 'Songs between repeats cannot exceed 50')
})

interface RefreshResponse {
  success: boolean
  message?: string
  playerStateRefresh?: boolean
}

export function GET(): NextResponse<{ message: string }> {
  return NextResponse.json({ message: 'GET handler is working' })
}

export async function POST(
  request: Request
): Promise<NextResponse<RefreshResponse>> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Request timed out'))
    }, TIMEOUT_MS)
  })

  try {
    const body = (await request.json()) as unknown
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

      // Extract specific error messages
      const errorMessages = Object.entries(formattedErrors)
        .filter(([key]) => key !== '_errors')
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `${key}: ${value.join(', ')}`
          }
          if (value && typeof value === 'object' && '_errors' in value) {
            return `${key}: ${value._errors.join(', ')}`
          }
          return `${key}: Invalid value`
        })
        .join('; ')

      return NextResponse.json(
        {
          success: false,
          message: 'Invalid request parameters',
          details: errorMessages
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

    const refreshPromise =
      PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(
        false,
        trackSuggestionsState
      )

    const result = await Promise.race([refreshPromise, timeoutPromise])

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Refresh Site] Error:', error)

    // Handle timeout specifically
    if (error instanceof Error && error.message === 'Request timed out') {
      return NextResponse.json(
        {
          success: false,
          message: 'Request timed out. Please try again.'
        },
        { status: 504 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to refresh site'
      },
      { status: 500 }
    )
  }
}
