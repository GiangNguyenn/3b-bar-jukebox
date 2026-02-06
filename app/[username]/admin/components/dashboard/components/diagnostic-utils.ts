import type { HealthStatus } from '@/shared/types/health'
import type { PlayerStatus } from '@/hooks/useSpotifyPlayer'

import { formatAbsoluteTime } from '@/lib/utils'

export function hasErrorStatus(healthStatus: HealthStatus): boolean {
  return (
    healthStatus.lastError != null ||
    healthStatus.device === 'error' ||
    healthStatus.device === 'disconnected' ||
    healthStatus.playback === 'error' ||
    healthStatus.playback === 'stalled' ||
    healthStatus.token === 'error' ||
    healthStatus.connection === 'disconnected' ||
    (healthStatus.failureMetrics?.consecutiveFailures ?? 0) > 0
  )
}

export function hasWarningStatus(healthStatus: HealthStatus): boolean {
  return (
    healthStatus.device === 'unresponsive' ||
    healthStatus.playback === 'paused' ||
    (healthStatus.tokenExpiringSoon ?? false) ||
    (healthStatus.queueState?.isEmpty ?? false) ||
    !(healthStatus.queueState?.hasNextTrack ?? false)
  )
}

export function getOverallSeverity(
  hasErrors: boolean,
  hasWarnings: boolean
): 'error' | 'warning' | 'info' {
  return hasErrors ? 'error' : hasWarnings ? 'warning' : 'info'
}

export function getSeverityStyles(
  severity: 'error' | 'warning' | 'info'
): string {
  const styles = {
    error: 'border-red-500/50 bg-red-900/20',
    warning: 'border-yellow-500/50 bg-yellow-900/20',
    info: 'border-gray-700 bg-gray-800/50'
  }
  return styles[severity]
}

export function formatEventType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Helper functions removed as formatDiagnosticsForClipboard now returns JSON

import { LogEntry as ConsoleLogEntry } from '@/hooks/ConsoleLogsProvider'

export function formatDiagnosticsForClipboard(
  healthStatus: HealthStatus,
  isReady: boolean,
  playerStatus: PlayerStatus | undefined,
  currentPlayerStatus: string,
  logs: ConsoleLogEntry[] = []
): string {
  const diagnosticData = {
    timestamp: new Date().toISOString(),
    systemInfo: healthStatus.systemInfo,
    systemStatus: {
      playerStatus: playerStatus ?? (isReady ? 'ready' : 'initializing'),
      deviceStatus: healthStatus.device,
      playbackStatus: healthStatus.playback,
      tokenStatus: healthStatus.token,
      tokenExpiringSoon: healthStatus.tokenExpiringSoon,
      connection: healthStatus.connection,
      deviceId: healthStatus.deviceId
    },
    criticalIssues: {
      lastError: healthStatus.lastError,
      lastErrorTimestamp: healthStatus.lastErrorTimestamp
        ? formatAbsoluteTime(healthStatus.lastErrorTimestamp)
        : undefined,
      deviceError: healthStatus.device === 'error',
      playbackError: healthStatus.playback === 'error',
      playbackStalled: healthStatus.playback === 'stalled',
      consecutiveFailures: healthStatus.failureMetrics?.consecutiveFailures,
      lastFailureTimestamp: healthStatus.failureMetrics?.lastFailureTimestamp
        ? formatAbsoluteTime(healthStatus.failureMetrics.lastFailureTimestamp)
        : undefined
    },
    playbackDetails: healthStatus.playbackDetails,
    queueState: healthStatus.queueState,
    recentEvents: healthStatus.recentEvents,
    connectivity: healthStatus.connectivityInvestigation,
    technicalDetails: {
      playerStatusInternal: currentPlayerStatus,
      failureMetrics: healthStatus.failureMetrics,
      internalState: healthStatus.internalState
    },
    logs: logs
  }

  return JSON.stringify(diagnosticData, null, 2)
}
