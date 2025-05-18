import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'

// Define the type that matches what the service returns
interface LastSuggestedTrack {
  name: string
  artist: string
  album: string
  uri: string
  popularity: number
  duration_ms: number
  preview_url: string | null
  genres: string[]
}

// Server-side cache for the last suggested track
let serverCache: LastSuggestedTrack | null = null

export function GET(): NextResponse {
  try {
    // If we have a cached track, return it immediately
    if (serverCache) {
      return NextResponse.json({
        success: true,
        track: serverCache,
        hasServerCache: true,
        timestamp: Date.now()
      })
    }

    // Otherwise, get the track from the service
    const service = PlaylistRefreshServiceImpl.getInstance()
    const track = service.getLastSuggestedTrack()

    // Update server cache if we got a track
    if (track) {
      serverCache = track
    }

    return NextResponse.json({
      success: true,
      track: track ?? null,
      hasServerCache: !!serverCache,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('[Last Suggested Track] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      },
      { status: 500 }
    )
  }
}

// POST endpoint to update the server cache
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const track = (await request.json()) as LastSuggestedTrack
    serverCache = track

    return NextResponse.json({
      success: true,
      track,
      hasServerCache: true,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('[Last Suggested Track] Error updating cache:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      },
      { status: 500 }
    )
  }
}
