'use client'

import { useCallback, useState } from 'react'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyApiService } from '@/services/spotifyApi'
import { type SpotifyPlaybackState } from '@/shared/types/spotify'
import { queueManager } from '@/services/queueManager'
import { playerLifecycleService } from '@/services/playerLifecycle'
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
  const { deviceId, playbackState, setPlaybackState } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()

  const getIsActuallyPlaying = useCallback(() => {
    if (!playbackState) return false
    if (!playbackState.is_playing) return false
    return true
  }, [playbackState])

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

      // Delegate track-to-track transition to playerLifecycleService so that
      // all playback starts flow through the same device management and
      // duplicate protection logic used for natural track finishes.
      try {
        await playerLifecycleService.playNextFromQueue()
      } catch (error) {
        addLog(
          'ERROR',
          'Failed to play next track after skip',
          'Playback',
          error instanceof Error ? error : undefined
        )
        // On error, fall back to pausing playback to avoid a stuck state.
        const spotifyApi = SpotifyApiService.getInstance()
        await spotifyApi.pausePlayback(deviceId)
      }
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
