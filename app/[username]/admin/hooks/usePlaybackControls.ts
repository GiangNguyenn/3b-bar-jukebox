'use client'

import { useCallback, useState } from 'react'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyApiService } from '@/services/spotifyApi'
import { type SpotifyPlaybackState } from '@/shared/types/spotify'
import { queueManager } from '@/services/queueManager'
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
        const result = await spotifyApi.pausePlayback(deviceId)
        if (!result.success) {
          throw new Error('Failed to pause playback')
        }
      } else {
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
    if (!deviceId || !playbackState?.item) {
      addLog(
        'WARN',
        'Cannot skip: No device or no currently playing track',
        'Playback'
      )
      return
    }

    setIsSkipLoading(true)

    try {
      const currentTrackId = playbackState.item.id
      const currentTrackName = playbackState.item.name
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

      // Get the next track from the queue after removing the current track
      // After markAsPlayed, the current track is removed from the queue
      // The queue shifts and queue[0] becomes the next highest priority track
      // getNextTrack() returns queue[0], which is the correct next track to play
      const nextTrack = queueManager.getNextTrack()

      if (nextTrack) {
        // Next track found - play it
        const trackUri = `spotify:track:${nextTrack.tracks.spotify_track_id}`

        try {
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              device_id: deviceId,
              uris: [trackUri]
            }
          })

          addLog(
            'INFO',
            `Now playing next track: ${nextTrack.tracks.name}`,
            'Playback'
          )
        } catch (error) {
          addLog(
            'ERROR',
            `Failed to play next track: ${nextTrack.tracks.name}`,
            'Playback',
            error instanceof Error ? error : undefined
          )
          // If playing next track fails, pause playback
          const spotifyApi = SpotifyApiService.getInstance()
          await spotifyApi.pausePlayback(deviceId)
        }
      } else {
        // Pause playback since there are no more tracks
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
