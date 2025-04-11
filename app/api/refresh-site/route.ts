export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const forceParam = url.searchParams.get('force')
    const shouldForce = forceParam === 'true'

    const result =
      await PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(
        shouldForce
      )

    // Only refresh player state if the playlist was actually updated
    if (result.success) {
      console.log('Playlist was updated, refreshing player state')

      try {
        // Get the current playback state
        const playbackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // If there's an active device
        if (playbackState?.device?.id) {
          console.log('Found active device, reinitializing playback')

          // Store current state before pausing
          const currentTrackUri = playbackState.item?.uri
          const currentPosition = playbackState.progress_ms
          const contextUri = playbackState.context?.uri

          // First pause playback
          await sendApiRequest({
            path: 'me/player/pause',
            method: 'PUT'
          })

          // Then resume with the exact same context and position
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: contextUri,
              position_ms: currentPosition,
              offset: currentTrackUri ? { uri: currentTrackUri } : undefined
            }
          })

          result.playerStateRefresh = true
        }
      } catch (error) {
        console.error('Error refreshing player state:', error)
        // Don't fail the request if player refresh fails
      }
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 500
    })
  } catch (error) {
    console.error('Error in refresh route:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      {
        status: 500
      }
    )
  }
}
