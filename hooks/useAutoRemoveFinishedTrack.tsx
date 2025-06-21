import { useEffect, useRef } from 'react'
import { useRemoveTrackFromPlaylist } from './useRemoveTrackFromPlaylist'
import { TrackItem, SpotifyPlaybackState } from '@/shared/types/spotify'
import { autoRemoveTrack } from '@/shared/utils/autoRemoveTrack'

interface UseAutoRemoveFinishedTrackProps {
  currentTrackId: string | null
  playlistTracks: TrackItem[]
  playbackState: SpotifyPlaybackState | null
  playlistId: string
  songsBetweenRepeats: number
}

export const useAutoRemoveFinishedTrack = ({
  currentTrackId,
  playlistTracks,
  playbackState,
  playlistId,
  songsBetweenRepeats
}: UseAutoRemoveFinishedTrackProps) => {
  const { removeTrack, isLoading } = useRemoveTrackFromPlaylist()
  const lastRemovalTimeRef = useRef<number>(0)
  const removalTimeoutRef = useRef<NodeJS.Timeout>()
  const previousTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      !currentTrackId ||
      !playbackState ||
      isLoading ||
      !playlistTracks.length ||
      !removeTrack
    )
      return

    const currentTrackIndex = playlistTracks.findIndex(
      (track) => track.track.id === currentTrackId
    )

    // If we have a previous track and it's different from current, it means the previous track finished
    if (
      previousTrackIdRef.current &&
      previousTrackIdRef.current !== currentTrackId
    ) {
      const previousTrackIndex = playlistTracks.findIndex(
        (track) => track.track.id === previousTrackIdRef.current
      )

      // If the previous track was in the playlist and we have enough tracks between repeats
      if (
        previousTrackIndex !== -1 &&
        currentTrackIndex >= songsBetweenRepeats
      ) {
        // Clear any pending removal
        if (removalTimeoutRef.current) {
          clearTimeout(removalTimeoutRef.current)
        }

        // Set a new timeout for the removal with a shorter delay
        removalTimeoutRef.current = setTimeout(async () => {
          const now = Date.now()
          // Only remove if at least 1 second has passed since last removal
          if (now - lastRemovalTimeRef.current >= 1000) {
            await autoRemoveTrack({
              playlistId,
              currentTrackId,
              playlistTracks,
              playbackState,
              songsBetweenRepeats,
              onSuccess: () => {
                lastRemovalTimeRef.current = now
                // Dispatch event to notify playlist needs refresh
                window.dispatchEvent(new Event('playlistRefresh'))
              }
            })
          }
        }, 1000) // Reduced from 5000ms to 1000ms
      }
    }

    // Update previous track reference
    previousTrackIdRef.current = currentTrackId
  }, [
    currentTrackId,
    playlistTracks,
    playbackState,
    removeTrack,
    isLoading,
    playlistId,
    songsBetweenRepeats
  ])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (removalTimeoutRef.current) {
        clearTimeout(removalTimeoutRef.current)
      }
    }
  }, [])
}
