import { TrackItem } from '@/shared/types'
import { sendApiRequest } from '@/shared/api'
import { useGetPlaylist } from './useGetPlaylist'
import { useTrackOperation } from './useTrackOperation'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { useState } from 'react'

interface UseAddTrackToPlaylistProps {
  playlistId: string
}

export const useAddTrackToPlaylist = ({
  playlistId,
}: UseAddTrackToPlaylistProps) => {
  const { isError: playlistError, refetchPlaylist } = useGetPlaylist(playlistId)
  const [pendingTracks, setPendingTracks] = useState<Set<string>>(new Set())

  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId,
    playlistError,
    refetchPlaylist,
  })

  const addTrack = async (track: TrackItem, onSuccess?: () => void) => {
    const operation = async (track: TrackItem) => {
      // Optimistically update UI
      setPendingTracks((prev) => new Set(prev).add(track.track.uri))

      try {
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: 'POST',
          body: {
            uris: [track.track.uri],
          },
        })
        onSuccess?.()
      } catch (error) {
        console.error('[Add Track] Error adding track:', error)
        // Revert optimistic update on error
        setPendingTracks((prev) => {
          const newSet = new Set(prev)
          newSet.delete(track.track.uri)
          return newSet
        })
        throw new Error(ERROR_MESSAGES.FAILED_TO_ADD)
      }
    }

    try {
      await executeOperation(operation, track)
    } catch (error) {
      console.error('[Add Track] Error adding track:', error)
    } finally {
      // Clear pending state after operation completes
      setPendingTracks((prev) => {
        const newSet = new Set(prev)
        newSet.delete(track.track.uri)
        return newSet
      })
    }
  }

  return {
    addTrack,
    isLoading,
    error,
    isSuccess,
    pendingTracks: Array.from(pendingTracks),
  }
}
