import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import {
  transferPlaybackToDevice,
  ensureDeviceHealth
} from '@/services/deviceManagement'
import { verifyPlaybackResume } from '@/shared/utils/recovery/playback-verification'

interface PlaybackRequest {
  action: 'play' | 'skip'
  contextUri?: string
  deviceId?: string
  position_ms?: number
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { action, contextUri, deviceId, position_ms } =
      (await request.json()) as PlaybackRequest

    console.log('[API Playback] Received request:', {
      action,
      contextUri,
      deviceId,
      position_ms,
      timestamp: new Date().toISOString()
    })

    if (!deviceId) {
      return NextResponse.json(
        { error: 'Device ID is required' },
        { status: 400 }
      )
    }

    // First ensure device is healthy
    const health = await ensureDeviceHealth(deviceId, {
      requireActive: true
    })

    if (!health.isHealthy) {
      return NextResponse.json(
        { error: `Device is not healthy: ${health.errors.join(', ')}` },
        { status: 400 }
      )
    }

    // Transfer playback to device
    const transferred = await transferPlaybackToDevice(deviceId)
    if (!transferred) {
      return NextResponse.json(
        { error: 'Failed to transfer playback to device' },
        { status: 500 }
      )
    }

    // Get current state for verification
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    // Verify device playback state
    await verifyPlaybackResume(state.context?.uri ?? '', deviceId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Playback API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
