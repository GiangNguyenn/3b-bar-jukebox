import { TrackItem, SpotifyPlaylistItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { useGetPlaylist } from './useGetPlaylist'
import { useTrackOperation } from './useTrackOperation'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { useState, useEffect, useRef } from 'react'

interface UseTrackOperationsProps {
  playlistId: string
  token?: string | null
}

interface TrackOperationsState {
  isLoading: boolean
  error: Error | null
  isSuccess: boolean
  pendingTracks: string[]
  optimisticTracks: TrackItem[]
  lastAddedTrack: TrackItem | null
}

export const useTrackOperations = ({
  playlistId,
  token
}: UseTrackOperationsProps) => {
  const {
    error: playlistError,
    refetch,
    data: playlist,
    addTrackOptimistically,
    removeTrackOptimistically,
    revertOptimisticUpdate
  } = useGetPlaylist({ playlistId, token })

  const [pendingTracks, setPendingTracks] = useState<Set<string>>(new Set())
  const [optimisticTracks, setOptimisticTracks] = useState<TrackItem[]>([])
  const [lastAddedTrack, setLastAddedTrack] = useState<TrackItem | null>(null)
  const optimisticTrackTimeRef = useRef<number>(0)

  // Clear optimistic tracks when they appear in playlist data
  useEffect(() => {
    if (optimisticTracks.length > 0 && playlist) {
      const timeSinceOptimisticTrack =
        Date.now() - optimisticTrackTimeRef.current
      if (timeSinceOptimisticTrack < 2000) {
        return
      }

      const realTrackIds = new Set(
        playlist.tracks.items
          .filter(
            (item) => item.added_by?.id && item.added_by.id !== 'optimistic'
          )
          .map((item) => item.track.id)
      )

      const newOptimisticTracks = optimisticTracks.filter(
        (track) => !realTrackIds.has(track.track.id)
      )

      if (newOptimisticTracks.length < optimisticTracks.length) {
        setOptimisticTracks(newOptimisticTracks)
        const newPendingTracks = new Set(pendingTracks)
        optimisticTracks.forEach((track) => {
          if (!newOptimisticTracks.includes(track)) {
            newPendingTracks.delete(track.track.uri)
          }
        })
        setPendingTracks(newPendingTracks)
      }
    }
  }, [playlist?.tracks?.items, optimisticTracks, pendingTracks])

  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId,
    playlistError: !!playlistError,
    refetchPlaylist: async (optimisticData?: SpotifyPlaylistItem) => {
      await refetch()
      return playlist
    }
  })

  // Helper function to set optimistic state
  const setOptimisticState = (track: TrackItem): void => {
    setPendingTracks((prev) => new Set(prev).add(track.track.uri))
    setOptimisticTracks((prev) => [...prev, track])
    optimisticTrackTimeRef.current = Date.now()
  }

  // Helper function to clear optimistic state
  const clearOptimisticState = (track: TrackItem): void => {
    setPendingTracks((prev) => {
      const newSet = new Set(prev)
      newSet.delete(track.track.uri)
      return newSet
    })
    setOptimisticTracks((prev) =>
      prev.filter((t) => t.track.id !== track.track.id)
    )
  }

  // Helper function to handle operation with optimistic updates
  const executeWithOptimisticUpdates = async (
    track: TrackItem,
    operation: () => Promise<void>,
    optimisticUpdate: () => void,
    errorMessage: string,
    operationName: string
  ): Promise<void> => {
    const operationWithOptimisticUpdates = async (
      track: TrackItem
    ): Promise<void> => {
      // Set optimistic state
      setOptimisticState(track)

      // Apply optimistic update immediately
      optimisticUpdate()

      try {
        await operation()
        // Don't immediately refetch - let the optimistic update persist
        // The track will be confirmed on the next natural refresh cycle

        // Set success state for toast
        if (operationName === 'Add Track') {
          setLastAddedTrack(track)
        }
      } catch (error) {
        // Revert optimistic update on error
        clearOptimisticState(track)
        revertOptimisticUpdate()
        throw new Error(errorMessage)
      }
    }

    try {
      await executeOperation(operationWithOptimisticUpdates, track)
    } catch (error) {
      throw error // Re-throw the error to be caught by the caller
    }
    // Don't clear optimistic state here - let it persist until next refresh cycle
  }

  const addTrack = async (track: TrackItem): Promise<void> => {
    const operation = async (): Promise<void> => {
      if (token) {
        // Use provided token
        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              uris: [track.track.uri]
            })
          }
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
      } else {
        // Use authenticated user's token via sendApiRequest
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: 'POST',
          body: {
            uris: [track.track.uri]
          }
        })
      }
    }

    await executeWithOptimisticUpdates(
      track,
      operation,
      () => addTrackOptimistically(track),
      ERROR_MESSAGES.FAILED_TO_ADD,
      'Add Track'
    )
  }

  const removeTrack = async (track: TrackItem): Promise<void> => {
    const operation = async (): Promise<void> => {
      if (token) {
        // Use provided token
        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              tracks: [{ uri: track.track.uri }]
            })
          }
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
      } else {
        // Use authenticated user's token via sendApiRequest
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: 'DELETE',
          body: { tracks: [{ uri: track.track.uri }] }
        })
      }
    }

    await executeWithOptimisticUpdates(
      track,
      operation,
      () => removeTrackOptimistically(track.track.uri),
      ERROR_MESSAGES.FAILED_TO_LOAD,
      'Remove Track'
    )
  }

  // Function to clear the last added track (for toast dismissal)
  const clearLastAddedTrack = (): void => {
    setLastAddedTrack(null)
  }

  return {
    addTrack,
    removeTrack,
    isLoading,
    error,
    isSuccess,
    pendingTracks: Array.from(pendingTracks),
    optimisticTracks,
    lastAddedTrack,
    clearLastAddedTrack
  }
}
