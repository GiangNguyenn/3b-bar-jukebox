import { TrackItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { useFixedPlaylist } from './useFixedPlaylist'
import { useGetPlaylist } from './useGetPlaylist'
import { useTrackOperation } from './useTrackOperation'
import {
  handleApiError,
  handleOperationError,
  AppError
} from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

export const useRemoveTrackFromPlaylist = () => {
  const { fixedPlaylistId, error: createPlaylistError } = useFixedPlaylist()
  const { isError: playlistError, refetchPlaylist } = useGetPlaylist(
    fixedPlaylistId ?? ''
  )
  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId: fixedPlaylistId,
    playlistError: playlistError || !!createPlaylistError,
    refetchPlaylist
  })

  const removeTrack = async (track: TrackItem) => {
    const operation = async (track: TrackItem) => {
      try {
        await sendApiRequest({
          path: `playlists/${fixedPlaylistId}/tracks`,
          method: 'DELETE',
          body: { tracks: [{ uri: track.track.uri }] }
        })
      } catch (error) {
        throw new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, error, 'RemoveTrack')
      }
    }

    await handleOperationError(
      () => executeOperation(operation, track),
      'RemoveTrackFromPlaylist',
      (error) => console.error('[Remove Track] Error removing track:', error)
    )
  }

  return {
    removeTrack: fixedPlaylistId ? removeTrack : null,
    isLoading,
    error,
    isSuccess
  }
}
