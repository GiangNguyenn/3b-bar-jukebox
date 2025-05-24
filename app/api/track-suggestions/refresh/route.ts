import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'

const refreshRequestSchema = z.object({
  genres: z.array(z.string()).min(1).max(10),
  yearRange: z.tuple([
    z.number().min(1900),
    z.number().max(new Date().getFullYear())
  ]),
  popularity: z.number().min(0).max(100),
  allowExplicit: z.boolean(),
  maxSongLength: z.number().min(30).max(600),
  songsBetweenRepeats: z.number().min(1).max(50),
  maxOffset: z.number().min(1).max(10000)
})

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as unknown
    console.log(
      'Raw request body received in API route (refresh/route.ts):',
      body
    )

    const validationResult = refreshRequestSchema.safeParse(body)

    if (!validationResult.success) {
      console.error('Invalid request:', validationResult.error)
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
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats,
      maxOffset
    } = validationResult.data
    console.log('Validated genres in API route (refresh/route.ts):', genres)

    const service = PlaylistRefreshServiceImpl.getInstance()
    const result = await service.refreshTrackSuggestions({
      genres,
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats,
      maxOffset
    })

    console.log('Success:', {
      timestamp: new Date().toISOString(),
      genres,
      yearRange,
      popularity,
      allowExplicit,
      maxSongLength,
      songsBetweenRepeats,
      maxOffset,
      result
    })

    return NextResponse.json({
      success: true,
      message: 'Track suggestions refreshed successfully',
      searchDetails: result.searchDetails
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to refresh track suggestions',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    )
  }
}
