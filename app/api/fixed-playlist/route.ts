import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaylists } from '@/shared/types/spotify'

// Configure the route to be dynamic
export const dynamic = 'force-dynamic'

const FIXED_PLAYLIST_NAME = '3B Saigon'

export async function GET(): Promise<NextResponse> {
  try {
    const response = await sendApiRequest<SpotifyPlaylists>({
      path: '/me/playlists'
    })

    const fixedPlaylist = response.items.find(
      (playlist) => playlist.name === FIXED_PLAYLIST_NAME
    )

    return NextResponse.json({ fixedPlaylistId: fixedPlaylist?.id ?? null })
  } catch (error) {
    console.error('[Fixed Playlist API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get fixed playlist' },
      { status: 500 }
    )
  }
}
