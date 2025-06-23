import { TrackItem, SpotifyPlaylistItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { useGetPlaylist } from './useGetPlaylist'
import { useTrackOperation } from './useTrackOperation'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { useState } from 'react'

interface UseTrackOperationsProps {
  playlistId: string
}

interface TrackOperationsState {
  isLoading: boolean
  error: Error | null
  isSuccess: boolean
  pendingTracks: string[]
  optimisticTrack: TrackItem | null
}

export const useTrackOperations = ({ playlistId }: UseTrackOperationsProps) => {
  const {
    isError: playlistError,
    refetchPlaylist,
    data: playlist
  } = useGetPlaylist(playlistId)
  const [pendingTracks, setPendingTracks] = useState<Set<string>>(new Set())
  const [optimisticTrack, setOptimisticTrack] = useState<TrackItem | null>(null)

  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId,
    playlistError,
    refetchPlaylist: async (optimisticData?: SpotifyPlaylistItem) => {
      return refetchPlaylist(optimisticData)
    }
  })

  // Helper function to set optimistic state
  const setOptimisticState = (track: TrackItem): void => {
    setPendingTracks((prev) => new Set(prev).add(track.track.uri))
    setOptimisticTrack(track)
  }

  // Helper function to clear optimistic state
  const clearOptimisticState = (track: TrackItem): void => {
    setPendingTracks((prev) => {
      const newSet = new Set(prev)
      newSet.delete(track.track.uri)
      return newSet
    })
    setOptimisticTrack(null)
  }

  // Helper function to create optimistic playlist for add operation
  const createOptimisticAddPlaylist = (
    track: TrackItem
  ): SpotifyPlaylistItem => ({
    ...playlist!,
    tracks: {
      ...playlist!.tracks,
      items: [
        ...playlist!.tracks.items,
        {
          ...track,
          added_at: new Date().toISOString(),
          added_by: {
            id: 'optimistic',
            uri: 'spotify:user:optimistic',
            href: 'https://api.spotify.com/v1/users/optimistic',
            external_urls: {
              spotify: 'https://open.spotify.com/user/optimistic'
            },
            type: 'user'
          }
        }
      ]
    }
  })

  // Helper function to create optimistic playlist for remove operation
  const createOptimisticRemovePlaylist = (
    track: TrackItem
  ): SpotifyPlaylistItem => ({
    ...playlist!,
    tracks: {
      ...playlist!.tracks,
      items: playlist!.tracks.items.filter(
        (item) => item.track.uri !== track.track.uri
      )
    }
  })

  // Helper function to handle operation with optimistic updates
  const executeWithOptimisticUpdates = async (
    track: TrackItem,
    operation: () => Promise<void>,
    createOptimisticPlaylist: (track: TrackItem) => SpotifyPlaylistItem,
    errorMessage: string,
    operationName: string
  ): Promise<void> => {
    const operationWithOptimisticUpdates = async (
      track: TrackItem
    ): Promise<void> => {
      // Set optimistic state
      setOptimisticState(track)

      // Optimistically update playlist data
      if (playlist) {
        const optimisticPlaylist = createOptimisticPlaylist(track)
        await refetchPlaylist(optimisticPlaylist)
      }

      try {
        await operation()
        // Refresh playlist with actual data
        await refetchPlaylist()
      } catch (error) {
        console.error(`[${operationName}] Error:`, error)
        // Revert optimistic update on error
        clearOptimisticState(track)
        // Revert playlist data on error
        await refetchPlaylist()
        throw new Error(errorMessage)
      }
    }

    try {
      await executeOperation(operationWithOptimisticUpdates, track)
    } catch (error) {
      console.error(`[${operationName}] Error:`, error)
      throw error // Re-throw the error to be caught by the caller
    } finally {
      // Clear pending state after operation completes
      clearOptimisticState(track)
    }
  }

  const addTrack = async (track: TrackItem): Promise<void> => {
    const operation = async (): Promise<void> => {
      await sendApiRequest({
        path: `playlists/${playlistId}/tracks`,
        method: 'POST',
        body: {
          uris: [track.track.uri]
        }
      })
    }

    await executeWithOptimisticUpdates(
      track,
      operation,
      createOptimisticAddPlaylist,
      ERROR_MESSAGES.FAILED_TO_ADD,
      'Add Track'
    )
  }

  const removeTrack = async (track: TrackItem): Promise<void> => {
    const operation = async (): Promise<void> => {
      await sendApiRequest({
        path: `playlists/${playlistId}/tracks`,
        method: 'DELETE',
        body: { tracks: [{ uri: track.track.uri }] }
      })
    }

    await executeWithOptimisticUpdates(
      track,
      operation,
      createOptimisticRemovePlaylist,
      ERROR_MESSAGES.FAILED_TO_LOAD,
      'Remove Track'
    )
  }

  return {
    addTrack,
    removeTrack,
    isLoading,
    error,
    isSuccess,
    pendingTracks: Array.from(pendingTracks),
    optimisticTrack
  }
}
