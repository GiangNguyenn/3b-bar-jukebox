import { useMemo } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useSpotifyPlayerStore } from './useSpotifyPlayer'
import {
  useTokenHealth,
  useDeviceHealth,
  useConnectionHealth,
  usePlaybackHealth
} from './health'
import { useDiagnosticEvents } from './useDiagnosticEvents'
import {
  HealthStatus,
  PlaybackDetails,
  QueueState,
  FailureMetrics
} from '@/shared/types/health'
import { queueManager } from '@/services/queueManager'

export function useSpotifyHealthMonitor(): HealthStatus {
  const { addLog } = useConsoleLogsContext()
  const {
    deviceId,
    status: playerStatus,
    lastError,
    lastStatusChange,
    consecutiveFailures,
    playbackState
  } = useSpotifyPlayerStore()

  // Use focused health hooks
  const tokenHealth = useTokenHealth()
  const deviceHealth = useDeviceHealth(deviceId)
  const connectionHealth = useConnectionHealth()
  const playbackHealth = usePlaybackHealth()
  const recentEvents = useDiagnosticEvents()

  // Map the new health status to the enhanced interface structure
  const healthStatus = useMemo((): HealthStatus => {
    // Build playback details
    const playbackDetails: PlaybackDetails | undefined = playbackState
      ? {
          currentTrack: playbackState.item
            ? {
                id: playbackState.item.id,
                name: playbackState.item.name,
                artist: playbackState.item.artists
                  .map((a) => a.name)
                  .join(', '),
                uri: playbackState.item.uri
              }
            : undefined,
          progress: playbackState.progress_ms ?? undefined,
          duration: playbackState.item?.duration_ms ?? undefined,
          isPlaying: playbackState.is_playing ?? false,
          isStalled: playbackHealth === 'stalled',
          lastProgressUpdate: playbackState.timestamp
            ? Date.now() - (playbackState.timestamp ?? 0)
            : undefined
        }
      : undefined

    // Build queue state
    const queue = queueManager.getQueue()

    // getNextTrack() now automatically excludes the currently playing track
    const nextTrack = queueManager.getNextTrack()

    const queueState: QueueState = {
      nextTrack: nextTrack
        ? {
            id: nextTrack.tracks.spotify_track_id,
            name: nextTrack.tracks.name,
            artist: nextTrack.tracks.artist,
            queueId: nextTrack.id
          }
        : undefined,
      queueLength: queue.length,
      isEmpty: queue.length === 0,
      hasNextTrack: nextTrack !== undefined
    }

    // Build failure metrics
    const failureMetrics: FailureMetrics = {
      consecutiveFailures,
      lastFailureTimestamp:
        lastError && lastStatusChange ? lastStatusChange : undefined,
      lastSuccessfulOperation:
        playerStatus === 'ready' && !lastError ? lastStatusChange : undefined
    }

    return {
      deviceId,
      device: deviceHealth,
      playback: playbackHealth,
      token: tokenHealth.status,
      tokenExpiringSoon: tokenHealth.expiringSoon,
      connection: connectionHealth,
      // Diagnostic fields
      lastError,
      lastErrorTimestamp: lastError ? lastStatusChange : undefined,
      recentEvents: recentEvents.length > 0 ? recentEvents : undefined,
      playbackDetails,
      queueState,
      failureMetrics
    }
  }, [
    deviceId,
    tokenHealth,
    deviceHealth,
    connectionHealth,
    playbackHealth,
    playbackState,
    recentEvents,
    lastError,
    lastStatusChange,
    consecutiveFailures,
    playerStatus
  ])

  return healthStatus
}
