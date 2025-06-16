import React, { useCallback } from 'react'
import { SpotifyApiService } from '@/services/spotifyApi'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

// Simple logger utility since we don't have access to the shared logger
const addLog = (
  level: 'INFO' | 'ERROR',
  message: string,
  category: string,
  error?: Error
) => {
  console.log(`[${level}] [${category}] ${message}`, error)
}

const usePlaybackManager = () => {
  const [deviceId, setDeviceId] = React.useState<string | null>(null)
  const [playbackState, setPlaybackState] =
    React.useState<SpotifyPlaybackState | null>(null)
  const [isLoading, setIsLoading] = React.useState<boolean>(false)
  const [loadingAction, setLoadingAction] = React.useState<string | null>(null)

  const handlePlayPause = useCallback(async () => {
    if (!deviceId) return

    try {
      setIsLoading(true)
      setLoadingAction('playPause')
      const spotifyApi = SpotifyApiService.getInstance()

      if (playbackState?.is_playing === true) {
        // If currently playing, pause playback
        const result = await spotifyApi.pausePlayback(deviceId)
        if (result.success) {
          addLog(
            'INFO',
            `[Playback] Paused successfully: deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
            'Playback',
            undefined
          )
        } else {
          throw new Error('Failed to pause playback')
        }
      } else {
        // If not playing, resume playback
        const result = await spotifyApi.resumePlayback()
        if (result.success) {
          addLog(
            'INFO',
            `[Playback] Resumed successfully: resumedFrom=${typeof result.resumedFrom === 'string' ? result.resumedFrom : JSON.stringify(result.resumedFrom)}, deviceId=${deviceId}, timestamp=${new Date().toISOString()}`,
            'Playback',
            undefined
          )
        } else {
          throw new Error('Failed to resume playback')
        }
      }

      // Add a small delay to allow the Spotify API to update
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Refresh the playback state
      const state = await spotifyApi.getPlaybackState()

      if (state?.device?.id === deviceId) {
        setPlaybackState(state)
      }
    } catch (error) {
      addLog(
        'ERROR',
        '[Playback] Control failed',
        'Playback',
        error instanceof Error ? error : undefined
      )
    } finally {
      setIsLoading(false)
      setLoadingAction(null)
    }
  }, [deviceId, playbackState?.is_playing, addLog, setPlaybackState])

  return {
    deviceId,
    setDeviceId,
    playbackState,
    setPlaybackState,
    isLoading,
    loadingAction,
    handlePlayPause
  }
}

export default usePlaybackManager
