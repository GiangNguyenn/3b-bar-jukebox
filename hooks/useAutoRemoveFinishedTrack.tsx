import { useEffect, useRef } from 'react'
import { useRemoveTrackFromPlaylist } from './useRemoveTrackFromPlaylist'
import { TrackItem, SpotifyPlaybackState } from '@/shared/types'
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
    if (currentTrackIndex === -1 || currentTrackIndex < songsBetweenRepeats)
      return

    // Clear any pending removal
    if (removalTimeoutRef.current) {
      clearTimeout(removalTimeoutRef.current)
    }

    // Set a new timeout for the removal
    removalTimeoutRef.current = setTimeout(async () => {
      const now = Date.now()
      // Only remove if at least 5 seconds have passed since last removal
      if (now - lastRemovalTimeRef.current >= 5000) {
        await autoRemoveTrack({
          playlistId,
          currentTrackId,
          playlistTracks,
          playbackState,
          songsBetweenRepeats,
          onSuccess: () => {
            lastRemovalTimeRef.current = now
          }
        })
      }
    }, 5000)
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
