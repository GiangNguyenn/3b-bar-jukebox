'use client'

import { useCallback, useState } from 'react'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyApiService } from '@/services/spotifyApi'
import { type SpotifyPlaybackState } from '@/shared/types/spotify'
import { queueManager } from '@/services/queueManager'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { djService } from '@/services/djService'
import { sendApiRequest } from '@/shared/api'

export function usePlaybackControls(): {
  isLoading: boolean
  isSkipLoading: boolean
  playbackInfo: SpotifyPlaybackState | null
  isActuallyPlaying: boolean
  handlePlayPause: () => Promise<void>
  handleSkip: () => Promise<void>
} {
  const [isLoading, setIsLoading] = useState(false)
  const [isSkipLoading, setIsSkipLoading] = useState(false)
  const { deviceId, playbackState, setPlaybackState, isTransitionInProgress } =
    useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()

  const getIsActuallyPlaying = useCallback(() => {
    // During a track transition, default to enabled rather than locking out controls
    if (isTransitionInProgress) return true
    if (!playbackState) return false
    if (!playbackState.is_playing) return false
    return true
  }, [playbackState, isTransitionInProgress])

  const handlePlayPause = useCallback(async (): Promise<void> => {
    if (!deviceId || !playbackState) return

    const originalState = playbackState
    const isPlaying = getIsActuallyPlaying()

    // Optimistic update
    setPlaybackState({
      ...originalState,
      is_playing: !isPlaying
    })
    setIsLoading(true)

    try {
      const spotifyApi = SpotifyApiService.getInstance()

      if (isPlaying) {
        // Set manual pause flag BEFORE calling API to prevent auto-resume race conditions
        playerLifecycleService.setManualPause(true)
        const result = await spotifyApi.pausePlayback(deviceId)
        if (!result.success) {
          // Revert flag on failure
          playerLifecycleService.setManualPause(false)
          throw new Error('Failed to pause playback')
        }
      } else {
        // Enforce Queue Logic: If resuming a track that is NOT in the queue, skip it.
        const queue = queueManager.getQueue()
        const currentTrackId = playbackState?.item?.id

        const isTrackInQueue = currentTrackId
          ? queue.some(
              (item) => item.tracks.spotify_track_id === currentTrackId
            )
          : false

        // If queue has tracks but current track isn't one of them, skip instead of resume
        if (queue.length > 0 && currentTrackId && !isTrackInQueue) {
          addLog(
            'WARN',
            '[handlePlayPause] Enforcing queue: Current track not in queue, skipping to next track.',
            'Playback'
          )

          // Play next track from queue
          await playerLifecycleService.playNextFromQueue()

          // Ensure manual pause flag is cleared (handled by playNextTrack, but good for safety)
          playerLifecycleService.setManualPause(false)
          setIsLoading(false)
          return
        }

        // Clear manual pause flag when resuming
        playerLifecycleService.setManualPause(false)

        // Get the current track's position if available
        const currentPosition = playbackState.progress_ms || 0
        const result = await spotifyApi.resumePlayback(currentPosition)
        if (!result.success) {
          throw new Error('Failed to resume playback')
        }

        // Prefetch DJ audio for the next track so it's ready when this one ends.
        // The resume path bypasses playNextTrackImpl (which normally calls
        // onTrackStarted), so we trigger the prefetch explicitly here.
        const currentQueueItem = currentTrackId
          ? queue.find(
              (item) => item.tracks.spotify_track_id === currentTrackId
            )
          : null
        if (currentQueueItem) {
          const nextTrack = queueManager.getNextTrack()
          djService.onTrackStarted(currentQueueItem, nextTrack ?? null)
        }
      }

      // No longer reconciling with the actual state from the API
    } catch (error) {
      addLog(
        'ERROR',
        'Playback control failed',
        'Playback',
        error instanceof Error ? error : undefined
      )
      // Rollback on error
      setPlaybackState(originalState)
    } finally {
      setIsLoading(false)
    }
  }, [deviceId, playbackState, getIsActuallyPlaying, addLog, setPlaybackState])

  const handleSkip = useCallback(async (): Promise<void> => {
    if (!deviceId) {
      addLog('WARN', 'Cannot skip: No device available', 'Playback')
      return
    }

    setIsSkipLoading(true)

    try {
      // Fetch real-time playback state from Spotify API to avoid race conditions
      // This ensures we always have the most current track information
      let currentPlaybackState: SpotifyPlaybackState | null = null

      try {
        currentPlaybackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })
      } catch (apiError) {
        addLog(
          'WARN',
          'Failed to fetch current playback state from API, falling back to cached state',
          'Playback',
          apiError instanceof Error ? apiError : undefined
        )
        // Fallback to cached state if API call fails
        currentPlaybackState = playbackState
      }

      // Verify we have a currently playing track
      if (!currentPlaybackState?.item) {
        addLog('WARN', 'Cannot skip: No currently playing track', 'Playback')
        setIsSkipLoading(false)
        return
      }

      const currentTrackId = currentPlaybackState.item.id
      const currentTrackName = currentPlaybackState.item.name
      addLog(
        'INFO',
        `Attempting to skip track: ${currentTrackName}`,
        'Playback'
      )

      // Find the queue item for the currently playing track
      const queue = queueManager.getQueue()
      const currentQueueItem = queue.find(
        (item) => item.tracks.spotify_track_id === currentTrackId
      )

      if (currentQueueItem) {
        // Track is in queue - remove it from the queue
        try {
          await queueManager.markAsPlayed(currentQueueItem.id)
          addLog(
            'INFO',
            `Removed track from queue: ${currentQueueItem.tracks.name}`,
            'Playback'
          )
        } catch (error) {
          addLog(
            'WARN',
            `Failed to remove track from queue: ${currentQueueItem.tracks.name}`,
            'Playback',
            error instanceof Error ? error : undefined
          )
          // Continue with skip even if queue removal fails
        }
      } else {
        addLog(
          'WARN',
          `Track not found in queue: ${currentTrackName} (ID: ${currentTrackId}). Skipping playback anyway.`,
          'Playback'
        )
      }

      // Find the next track now (before any async gap) and play it directly.
      // Using skipToTrack avoids the pause→SDK-state-change→handleTrackFinished
      // race condition that playNextFromQueue causes.
      const nextTrack = queueManager.getNextTrack()
      if (!nextTrack) {
        addLog('WARN', 'No next track available to skip to', 'Playback')
        return
      }

      await playerLifecycleService.skipToTrack(nextTrack)
    } catch (error) {
      addLog(
        'ERROR',
        'Skip operation failed',
        'Playback',
        error instanceof Error ? error : undefined
      )
      // On error, try to pause playback to stop current track
      try {
        const spotifyApi = SpotifyApiService.getInstance()
        await spotifyApi.pausePlayback(deviceId)
      } catch (pauseError) {
        addLog(
          'ERROR',
          'Failed to pause playback after skip error',
          'Playback',
          pauseError instanceof Error ? pauseError : undefined
        )
      }
    } finally {
      setIsSkipLoading(false)
    }
  }, [deviceId, playbackState, addLog])

  return {
    isLoading,
    isSkipLoading,
    playbackInfo: playbackState,
    isActuallyPlaying: getIsActuallyPlaying(),
    handlePlayPause,
    handleSkip
  }
}
