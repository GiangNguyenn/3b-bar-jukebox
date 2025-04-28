import { SpotifyPlaybackState } from '@/shared/types'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

interface PlaybackResponse {
  success: boolean
  resumedFrom?: {
    trackUri: string
    position: number
  }
}

interface PlaybackError {
  error: {
    message: string
  }
}

interface PlaybackRequest {
  accessToken: string
  deviceId: string
  trackUri?: string
  positionMs?: number
  contextUri?: string
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (retries === 0) throw error

    // Check if error is recoverable
    const isRecoverable =
      error instanceof Error &&
      (error.message.includes('No active device') ||
        error.message.includes('Player command failed') ||
        error.message.includes('Playback not available'))

    if (!isRecoverable) throw error

    // Wait with exponential backoff
    const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries)
    await new Promise((resolve) => setTimeout(resolve, delay))

    return retryWithBackoff(fn, retries - 1)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as PlaybackRequest
    const { accessToken, deviceId, trackUri, positionMs, contextUri } = body

    if (!accessToken || !deviceId) {
      return new Response(
        JSON.stringify({
          error: 'Missing required parameters'
        }),
        { status: 400 }
      )
    }

    // First, ensure the device is active
    await retryWithBackoff(async () => {
      const transferResponse = await fetch(
        'https://api.spotify.com/v1/me/player',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            device_ids: [deviceId],
            play: false
          })
        }
      )

      if (!transferResponse.ok) {
        throw new Error('Failed to transfer playback')
      }
    })

    // Get current playback state to resume from
    const stateResponse = await fetch('https://api.spotify.com/v1/me/player', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!stateResponse.ok) {
      throw new Error('Failed to get playback state')
    }

    const state = (await stateResponse.json()) as SpotifyPlaybackState
    const currentTrackUri = state?.item?.uri
    const currentPosition = state?.progress_ms ?? 0

    // Then start playback with retries
    await retryWithBackoff(async () => {
      const response = await fetch(
        'https://api.spotify.com/v1/me/player/play?device_id=' + deviceId,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...(trackUri ? { uris: [trackUri] } : {}),
            ...(contextUri ? { context_uri: contextUri } : {}),
            position_ms: currentPosition,
            offset: currentTrackUri ? { uri: currentTrackUri } : undefined
          })
        }
      )

      if (!response.ok) {
        const errorData = (await response.json()) as PlaybackError
        throw new Error(errorData.error?.message ?? 'Playback failed')
      }
    })

    const response: PlaybackResponse = {
      success: true,
      resumedFrom: currentTrackUri
        ? {
            trackUri: currentTrackUri,
            position: currentPosition
          }
        : undefined
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Playback error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500 }
    )
  }
}
