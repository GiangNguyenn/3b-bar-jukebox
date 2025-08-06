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
        const result = await spotifyApi.resumePlayback()
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
      addLog(
        'INFO',
        `Attempting to skip track: ${playbackState.item.name}`,
        'Playback'
      )

      // Find the queue item for the currently playing track
      const queue = queueManager.getQueue()
      const currentQueueItem = queue.find(
        (item) => item.tracks.spotify_track_id === currentTrackId
      )

      if (!currentQueueItem) {
        addLog(
          'WARN',
          `No queue item found for currently playing track: ${currentTrackId}`,
          'Playback'
        )
        return
      }

      // Remove the current track from the queue
      await queueManager.markAsPlayed(currentQueueItem.id)
      addLog(
        'INFO',
        `Removed track from queue: ${currentQueueItem.tracks.name}`,
        'Playback'
      )

      // Get the next track from the queue
      const nextTrack = queueManager.getNextTrack()

      if (nextTrack) {
        // Play the next track
        const trackUri = `spotify:track:${nextTrack.tracks.spotify_track_id}`

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
      } else {
        addLog('INFO', 'No more tracks in queue after skip', 'Playback')
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
