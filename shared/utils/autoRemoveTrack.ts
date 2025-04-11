import { TrackItem, SpotifyPlaybackState } from '@/shared/types'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from './errorHandling'

interface AutoRemoveTrackParams {
  playlistId: string
  currentTrackId: string | null
  playlistTracks: TrackItem[]
  playbackState: SpotifyPlaybackState | null
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export async function autoRemoveTrack({
  playlistId,
  currentTrackId,
  playlistTracks,
  playbackState,
  onSuccess,
  onError,
}: AutoRemoveTrackParams): Promise<boolean> {
  if (!currentTrackId || !playbackState || !playlistTracks.length) return false

  const currentTrackIndex = playlistTracks.findIndex(
    (track) => track.track.id === currentTrackId,
  )
  if (currentTrackIndex === -1 || currentTrackIndex < 20) return false

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
            tracks: [{ uri: trackToRemove.track.uri }],
          },
        })
        onSuccess?.()
      },
      'AutoRemoveTrack',
      (error) => {
        console.error('[Auto Remove] Error removing track:', error)
        onError?.(error)
      },
    )
    return true
  } catch (error) {
    return false
  }
}
