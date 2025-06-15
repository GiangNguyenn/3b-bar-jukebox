'use client'

import { useCallback, useState } from 'react'
import { PlaybackControls } from './components/playback-controls'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer'

interface DashboardTabProps {
  playbackState: SpotifyPlaybackState | null
}

export function DashboardTab({ playbackState }: DashboardTabProps): JSX.Element {
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isPlayerReady = useSpotifyPlayer((state) => state.isReady)
  const [loadingAction, setLoadingAction] = useState<'playPause' | null>(null)

  const handlePlayPause = useCallback((): void => {
    if (!isPlayerReady || !deviceId) return

    setLoadingAction('playPause')
    const action = playbackState?.is_playing ? 'pause' : 'play'
    fetch('/api/playback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action })
    })
      .catch((error) => {
        console.error('Failed to toggle playback:', error)
      })
      .finally(() => {
        setLoadingAction(null)
      })
  }, [isPlayerReady, deviceId, playbackState?.is_playing])

  return (
    <PlaybackControls
      playbackState={playbackState}
      canControlPlayback={isPlayerReady && deviceId !== null}
      isLoading={loadingAction !== null}
      loadingAction={loadingAction}
      onPlayPause={handlePlayPause}
    />
  )
} 