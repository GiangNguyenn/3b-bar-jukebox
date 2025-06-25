'use client'

import { useCallback, useState } from 'react'
import { useSpotifyPlayerStore } from '@/hooks/useSpotifyPlayer'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyApiService } from '@/services/spotifyApi'
import { type SpotifyPlaybackState } from '@/shared/types/spotify'

export function usePlaybackControls() {
  const [isLoading, setIsLoading] = useState(false)
  const {
    deviceId,
    playbackState,
    setPlaybackState
  } = useSpotifyPlayerStore()
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

      // Reconcile with the actual state from the API
      const actualState = await spotifyApi.getPlaybackState()
      if (actualState) {
        setPlaybackState(actualState)
      } else {
        // If we can't get the state, revert to the original
        setPlaybackState(originalState)
      }
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
  }, [
    deviceId,
    playbackState,
    getIsActuallyPlaying,
    addLog,
    setPlaybackState
  ])

  return {
    isLoading,
    playbackInfo: playbackState,
    isActuallyPlaying: getIsActuallyPlaying(),
    handlePlayPause
  }
}