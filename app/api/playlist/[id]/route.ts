import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaylistItem } from '@/shared/types'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse<SpotifyPlaylistItem | { error: string }>> {
  try {
    const playlist = await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${params.id}`
    })
    return NextResponse.json(playlist)
  } catch (error) {
    console.error('[API Playlist] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch playlist' },
      { status: 500 }
    )
  }
}
