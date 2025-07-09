import { TrackItem, SpotifyPlaylistItem } from '@/shared/types/spotify'
import { sendApiRequest, logTrackSuggestion } from '@/shared/api'
import { useTrackOperation } from './useTrackOperation'
import { useGetProfile } from './useGetProfile'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { useState, useEffect, useRef } from 'react'
import { useGetPlaylist } from './useGetPlaylist'

interface UseTrackOperationsProps {
  playlistId: string
  token?: string | null
  username?: string
  playlist: SpotifyPlaylistItem | null
  addTrackOptimistically: (track: TrackItem) => void
  revertOptimisticUpdate: () => void
  refetch: () => void
  playlistError: string | null
}

interface TrackOperationsState {
  isLoading: boolean
  error: Error | null
  isSuccess: boolean
  pendingTracks: string[]
  lastAddedTrack: TrackItem | null
}

export const useTrackOperations = ({
  playlistId,
  token,
  username,
  playlist,
  addTrackOptimistically,
  revertOptimisticUpdate,
  refetch,
  playlistError
}: UseTrackOperationsProps) => {
  const { profile } = useGetProfile()

  const [pendingTracks, setPendingTracks] = useState<Set<string>>(new Set())
  const [lastAddedTrack, setLastAddedTrack] = useState<TrackItem | null>(null)
  const optimisticTrackTimeRef = useRef<number>(0)

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
    optimisticTrackTimeRef.current = Date.now()
  }

  // Helper function to clear optimistic state
  const clearOptimisticState = (track: TrackItem): void => {
    setPendingTracks((prev) => {
      const newSet = new Set(prev)
      newSet.delete(track.track.uri)
      return newSet
    })
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
      const body: {
        trackUri: string
        profileId?: string
        username?: string
      } = {
        trackUri: track.track.uri
      }
      if (profile) {
        body.profileId = profile.id
      }
      if (username) {
        body.username = username
      }

      await sendApiRequest({
        path: `playlist/${playlistId}`,
        method: 'POST',
        isLocalApi: true,
        body
      })
    }

    await executeWithOptimisticUpdates(
      track,
      operation,
      () => addTrackOptimistically(track),
      ERROR_MESSAGES.FAILED_TO_ADD,
      'Add Track'
    )
  }

  const removeTrack = async (
    track: TrackItem,
    position: number
  ): Promise<void> => {
    const operation = async (): Promise<void> => {
      const tracksToRemove = [{ uri: track.track.uri, positions: [position] }]

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
              tracks: tracksToRemove
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
          body: { tracks: tracksToRemove }
        })
      }
    }

    await executeWithOptimisticUpdates(
      track,
      operation,
      () => {},
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
    lastAddedTrack,
    clearLastAddedTrack
  }
}
