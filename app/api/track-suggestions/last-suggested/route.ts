import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'

// Server-side cache for the last suggested track
let serverCache: {
  name: string
  artist: string
  album: string
  uri: string
  popularity: number
  duration_ms: number
  preview_url: string | null
  genres: string[]
} | null = null

// Function to update the server cache
export function updateServerCache(track: {
  name: string
  artist: string
  album: string
  uri: string
  popularity: number
  duration_ms: number
  preview_url: string | null
  genres: string[]
}): void {
  serverCache = track
}

export async function GET(): Promise<NextResponse> {
  try {
    // If we have a cached track, return it immediately
    if (serverCache) {
      return NextResponse.json({
        track: serverCache,
        timestamp: new Date().toISOString()
      })
    }

    // Otherwise, try to get a new track from the service
    const service = PlaylistRefreshServiceImpl.getInstance()
    const track = service.getLastSuggestedTrack()

    // Update our server-side cache if we got a new track
    if (track) {
      serverCache = track
    }

    // Return either the new track or our cached track
    const responseTrack = track || serverCache

    return NextResponse.json({
      track: responseTrack,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('[API Last Suggested Track] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get last suggested track' },
      { status: 500 }
    )
  }
}

// POST endpoint to update the server cache
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const track = await request.json()
    updateServerCache(track)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API Last Suggested Track] Error updating cache:', error)
    return NextResponse.json(
      { error: 'Failed to update cache' },
      { status: 500 }
    )
  }
}
