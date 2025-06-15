import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { deviceId } = await request.json()

    if (!deviceId) {
      return NextResponse.json(
        { error: 'Device ID is required' },
        { status: 400 }
      )
    }

    // Transfer playback to our device
    await sendApiRequest({
      path: 'me/player',
      method: 'PUT',
      body: {
        device_ids: [deviceId],
        play: false // Don't start playing automatically
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PlaybackTransfer] Error:', error)
    return NextResponse.json(
      { error: 'Failed to transfer playback' },
      { status: 500 }
    )
  }
} 