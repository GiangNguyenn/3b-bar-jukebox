'use client'

import { useState, useEffect } from 'react'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

/**
 * Creates a smoothly ticking progress state based on the server's playback state.
 * Advances the progress by 1 second locally when `is_playing` is true,
 * eliminating the need to poll the server for progress updates.
 */
export function useSmoothProgress(
  playbackState: SpotifyPlaybackState | null
): [number | null, React.Dispatch<React.SetStateAction<number | null>>] {
  const [localProgress, setLocalProgress] = useState<number | null>(null)

  useEffect(() => {
    if (!playbackState?.item) {
      setLocalProgress(null)
      return
    }

    // Initialize with the current progress reported by the server
    setLocalProgress(playbackState.progress_ms || 0)

    // Only set up the timer if the track is actually playing
    if (!playbackState.is_playing) {
      return
    }

    const duration = playbackState.item.duration_ms || 0

    const intervalId = setInterval(() => {
      setLocalProgress((prev) => {
        if (prev === null) return null
        const next = prev + 1000
        // Cap the progress at the track's total duration
        return next > duration ? duration : next
      })
    }, 1000)

    return () => clearInterval(intervalId)
  }, [
    playbackState?.item?.id,
    playbackState?.is_playing,
    playbackState?.progress_ms,
    playbackState?.timestamp // Resync if the server sends a fresh update
  ])

  return [localProgress, setLocalProgress]
}
