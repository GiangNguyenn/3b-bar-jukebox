import { TrackItem, SpotifyPlaybackState } from '@/shared/types'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from './errorHandling'

interface AutoRemoveTrackParams {
  playlistId: string
  currentTrackId: string | null
  playlistTracks: TrackItem[]
  playbackState: SpotifyPlaybackState | null
  songsBetweenRepeats: number
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export async function autoRemoveTrack({
  playlistId,
  currentTrackId,
  playlistTracks,
  playbackState,
  songsBetweenRepeats,
  onSuccess,
  onError
}: AutoRemoveTrackParams): Promise<boolean> {
  if (!currentTrackId || !playbackState || !playlistTracks.length) return false

  // If playlist is not longer than songsBetweenRepeats, don't remove anything
  if (playlistTracks.length <= songsBetweenRepeats) {
    return false
  }

  // Always remove the first track if playlist is longer than songsBetweenRepeats
  const trackToRemove = playlistTracks[0]
  if (!trackToRemove) {
    console.error('[Auto Remove] No tracks to remove')
    return false
  }

  try {
    await handleOperationError(
      async () => {
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: 'DELETE',
          body: {
            tracks: [{ uri: trackToRemove.track.uri }]
          }
        })
        onSuccess?.()
      },
      'AutoRemoveTrack',
      (error) => {
        console.error('[Auto Remove] Error removing track:', error)
        onError?.(error)
      }
    )
    return true
  } catch (error) {
    return false
  }
}
