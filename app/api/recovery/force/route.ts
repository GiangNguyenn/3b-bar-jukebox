import { NextResponse } from 'next/server'
import { useRecoverySystem } from '@/hooks/recovery'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import * as Sentry from '@sentry/nextjs'

export async function POST(request: Request): Promise<NextResponse> {
  console.log('[Recovery] Starting force recovery process')
  try {
    // Get the device ID from the request body
    const { deviceId } = await request.json()
    if (!deviceId) {
      throw new Error('No device ID provided')
    }

    // Get the fixed playlist ID
    const fixedPlaylistId = useFixedPlaylist.getState().fixedPlaylistId
    if (!fixedPlaylistId) {
      throw new Error('No fixed playlist ID found')
    }

    // Initialize recovery system
    const { recover } = useRecoverySystem(
      deviceId,
      fixedPlaylistId,
      (status) => {
        console.log('[Recovery] Health status update:', status)
      }
    )

    // Start recovery process
    await recover()

    // Log success
    console.log('[Recovery] Force recovery completed successfully', {
      deviceId,
      fixedPlaylistId,
      timestamp: new Date().toISOString()
    })
    Sentry.logger.warn('Force recovery completed successfully', {
      deviceId,
      fixedPlaylistId,
      timestamp: new Date().toISOString()
    })

    return NextResponse.json({ success: true, deviceId })
  } catch (error) {
    // Log error
    console.error('[Recovery] Force recovery failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    Sentry.logger.error('Force recovery failed', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 }
    )
  }
} 