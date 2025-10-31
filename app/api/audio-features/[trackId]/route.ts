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

  try {
    const audioFeatures = await sendApiRequest<SpotifyAudioFeatures>({
      path: `audio-features/${trackId}`,
      method: 'GET',
      useAppToken: true // Use app token for public features
    })

    return NextResponse.json(audioFeatures)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    // Check if it's an ApiError with status
    let statusCode = 500
    if (error instanceof Error && error.name === 'ApiError') {
      const apiError = error as { status?: number }
      statusCode = apiError.status ?? 500
    }

    // Determine if this is a token/authentication issue
    const isTokenError =
      statusCode === 401 ||
      errorMessage.toLowerCase().includes('token') ||
      errorMessage.toLowerCase().includes('authentication') ||
      errorMessage.toLowerCase().includes('authorization') ||
      errorMessage.toLowerCase().includes('could not retrieve app access token')

    logger(
      'ERROR',
      `Error fetching audio features for track ${trackId}: ${errorMessage}`,
      'AudioFeatures',
      error instanceof Error ? error : undefined
    )

    // Return 503 (Service Unavailable) for token/authentication errors
    // Return 500 for other unexpected errors
    const httpStatus = isTokenError ? 503 : statusCode

    return NextResponse.json(
      {
        error: 'Failed to fetch audio features',
        code: isTokenError ? 'AUTH_ERROR' : 'FETCH_ERROR',
        status: httpStatus
      },
      { status: httpStatus }
    )
  }
}
