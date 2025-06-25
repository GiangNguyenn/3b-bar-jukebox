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
  optimisticTrack: TrackItem | null
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
  const [optimisticTrack, setOptimisticTrack] = useState<TrackItem | null>(null)
  const [lastAddedTrack, setLastAddedTrack] = useState<TrackItem | null>(null)
  const optimisticTrackTimeRef = useRef<number>(0)

  // Clear optimistic track when the real track appears in playlist data
  useEffect(() => {
    if (optimisticTrack && playlist) {
      // Don't clear optimistic track for at least 2 seconds after it's set
      const timeSinceOptimisticTrack = Date.now() - optimisticTrackTimeRef.current
      if (timeSinceOptimisticTrack < 2000) {
        return
      }
      
      const matchingTracks = playlist.tracks.items.filter(
        item => item.track.id === optimisticTrack.track.id
      )
      
      // Look for a track with a real added_by ID (not optimistic)
      const realTrack = matchingTracks.find(
        item => item.added_by?.id && item.added_by.id !== 'optimistic'
      )
      
      if (realTrack) {
        setOptimisticTrack(null)
        setPendingTracks((prev) => {
          const newSet = new Set(prev)
          newSet.delete(optimisticTrack.track.uri)
          return newSet
        })
      }
    }
  }, [playlist?.tracks?.items, optimisticTrack]) // Only depend on the tracks array, not the entire playlist object

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
    setOptimisticTrack(track)
    optimisticTrackTimeRef.current = Date.now()
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
    optimisticTrack,
    lastAddedTrack,
    clearLastAddedTrack
  }
}
