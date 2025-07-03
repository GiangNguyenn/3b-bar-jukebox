import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaylistItem } from '@/shared/types/spotify'
import { cache } from '@/shared/utils/cache'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse<SpotifyPlaylistItem | { error: string }>> {
  try {
    // Check cache first
    const cacheKey = `api-playlist-${params.id}`
    const cachedData = cache.get<SpotifyPlaylistItem>(cacheKey)
    if (cachedData) {
      return NextResponse.json(cachedData)
    }

    // If not in cache, fetch from Spotify API
    const playlist = await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${params.id}`
    })

    // Cache the result
    cache.set(cacheKey, playlist)

    return NextResponse.json(playlist)
  } catch (error) {
    console.error('[API Playlist] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch playlist' },
      { status: 500 }
    )
  }
}
