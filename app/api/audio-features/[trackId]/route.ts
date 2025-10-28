import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyAudioFeatures } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Audio Features')

interface ErrorResponse {
  error: string
  code: string
  status: number
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> }
): Promise<NextResponse<SpotifyAudioFeatures | ErrorResponse>> {
  try {
    const { trackId } = await params

    if (!trackId) {
      logger('ERROR', 'Missing track ID in audio features request')
      return NextResponse.json(
        {
          error: 'Track ID is required',
          code: 'MISSING_TRACK_ID',
          status: 400
        },
        { status: 400 }
      )
    }

    logger('INFO', `Fetching audio features for track: ${trackId}`)

    const audioFeatures = await sendApiRequest<SpotifyAudioFeatures>({
      path: `audio-features/${trackId}`,
      method: 'GET',
      useAppToken: true // Use app token for public features
    })

    logger('INFO', 'Audio features fetched successfully')
    return NextResponse.json(audioFeatures)
  } catch (error) {
    logger(
      'ERROR',
      'Error fetching audio features:',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      {
        error: 'Failed to fetch audio features',
        code: 'FETCH_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
