import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const refreshRequestSchema = z.object({
  genres: z.array(z.string()),
  yearRangeStart: z.number().min(1900),
  yearRangeEnd: z.number().max(new Date().getFullYear()),
  popularity: z.number().min(0).max(100),
  allowExplicit: z.boolean(),
  maxSongLength: z.number().min(30).max(600),
  songsBetweenRepeats: z.number().min(1).max(50)
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
  try {
    const body = await request.json() as unknown
    const validationResult = refreshRequestSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid request parameters',
          details: validationResult.error.format()
        },
        { status: 400 }
      )
    }

    const {
      genres,
      yearRangeStart,
      yearRangeEnd,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats
    } = validationResult.data

    const trackSuggestionsState = {
      genres,
      yearRange: [yearRangeStart, yearRangeEnd] as [number, number],
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats
    }

    const result =
      await PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(
        false,
        trackSuggestionsState
      )

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Refresh Site] Error:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to refresh site'
      },
      { status: 500 }
    )
  }
}
