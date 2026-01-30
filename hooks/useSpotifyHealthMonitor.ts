'use client'

import { useMemo } from 'react'
import pkg from '@/package.json'
import { useSpotifyPlayerStore } from './useSpotifyPlayer'
import { playerLifecycleService } from '@/services/playerLifecycle'
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
  FailureMetrics,
  SystemInfo
} from '@/shared/types/health'
import { queueManager } from '@/services/queueManager'
import {
  isValidErrorTimestamp,
  isValidSuccessTimestamp
} from '@/shared/utils/timestampValidation'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

/**
 * Builds playback details from playback state
 */
function buildPlaybackDetails(
  playbackState: SpotifyPlaybackState | null,
  playbackHealth:
    | 'playing'
    | 'paused'
    | 'stopped'
    | 'error'
    | 'unknown'
    | 'stalled'
): PlaybackDetails | undefined {
  if (!playbackState) {
    return undefined
  }

  return {
    currentTrack: playbackState.item
      ? {
          id: playbackState.item.id,
          name: playbackState.item.name,
          artist: playbackState.item.artists.map((a) => a.name).join(', '),
          uri: playbackState.item.uri
        }
      : undefined,
    progress: playbackState.progress_ms ?? undefined,
    duration: playbackState.item?.duration_ms ?? undefined,
    isPlaying: playbackState.is_playing ?? false,
    isStalled: playbackHealth === 'stalled',
    lastProgressUpdate: playbackState.timestamp ?? undefined
  }
}

/**
 * Builds queue state from queue manager
 */
function buildQueueState(): QueueState {
  const queue = queueManager.getQueue()
  const nextTrack = queueManager.getNextTrack()

  return {
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
}

/**
 * Builds failure metrics from player state
 */
function buildFailureMetrics(
  consecutiveFailures: number,
  playerStatus: string,
  lastError: string | undefined,
  lastStatusChange: number | undefined
): FailureMetrics {
  const hasValidError = isValidErrorTimestamp(lastError, lastStatusChange)
  const hasValidSuccess = isValidSuccessTimestamp(
    playerStatus,
    lastError,
    lastStatusChange
  )

  return {
    consecutiveFailures,
    lastFailureTimestamp: hasValidError ? lastStatusChange : undefined,
    lastSuccessfulOperation: hasValidSuccess ? lastStatusChange : undefined
  }
}

/**
 * Captures system information
 */
function getSystemInfo(): SystemInfo {
  if (typeof window === 'undefined') {
    return {
      userAgent: 'SSR',
      platform: 'Server',
      screenResolution: 'unknown',
      windowSize: 'unknown',
      timezone: 'UTC',
      connectionType: 'unknown',
      appVersion: pkg.version,
      uptime: 0
    }
  }

  const conn =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    windowSize: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connectionType: conn ? conn.effectiveType || 'unknown' : 'unknown',
    appVersion: pkg.version,
    uptime: performance.now() / 1000
  }
}

export function useSpotifyHealthMonitor(): HealthStatus {
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
    const hasValidError = isValidErrorTimestamp(lastError, lastStatusChange)

    return {
      deviceId,
      device: deviceHealth,
      playback: playbackHealth,
      token: tokenHealth.status,
      tokenExpiringSoon: tokenHealth.expiringSoon,
      connection: connectionHealth,
      // Diagnostic fields
      lastError,
      lastErrorTimestamp: hasValidError ? lastStatusChange : undefined,
      recentEvents: recentEvents.length > 0 ? recentEvents : undefined,
      playbackDetails: buildPlaybackDetails(playbackState, playbackHealth),
      queueState: buildQueueState(),
      failureMetrics: buildFailureMetrics(
        consecutiveFailures,
        playerStatus,
        lastError,
        lastStatusChange
      ),
      systemInfo: getSystemInfo(),
      internalState:
        typeof window !== 'undefined'
          ? playerLifecycleService.getDiagnostics()
          : undefined
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
