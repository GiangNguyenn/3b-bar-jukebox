import type { HealthStatus } from '@/shared/types/health'
import type { PlayerStatus } from '@/hooks/useSpotifyPlayer'
import { formatDuration, formatAbsoluteTime } from '@/lib/utils'

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

function formatSystemInfo(healthStatus: HealthStatus): string[] {
  const lines: string[] = []
  if (!healthStatus.systemInfo) {
    return lines
  }

  const { systemInfo } = healthStatus
  lines.push('--- SYSTEM INFO ---')
  lines.push(`App Version: ${systemInfo.appVersion}`)
  lines.push(`User Agent: ${systemInfo.userAgent}`)
  lines.push(`Platform: ${systemInfo.platform}`)
  lines.push(`Screen Resolution: ${systemInfo.screenResolution}`)
  lines.push(`Window Size: ${systemInfo.windowSize}`)
  lines.push(`Timezone: ${systemInfo.timezone}`)
  lines.push(`Connection Type: ${systemInfo.connectionType}`)
  return lines
}

function formatSystemStatus(
  healthStatus: HealthStatus,
  playerStatus: PlayerStatus | undefined,
  isReady: boolean
): string[] {
  const lines: string[] = []
  lines.push('--- SYSTEM STATUS ---')
  lines.push(
    `Player Status: ${playerStatus ?? (isReady ? 'ready' : 'initializing')}`
  )
  lines.push(`Device Status: ${healthStatus.device}`)
  lines.push(`Playback Status: ${healthStatus.playback}`)
  lines.push(
    `Token Status: ${healthStatus.token}${healthStatus.tokenExpiringSoon ? ' (expiring soon)' : ''}`
  )
  lines.push(`Connection: ${healthStatus.connection}`)
  if (healthStatus.deviceId) {
    lines.push(`Device ID: ${healthStatus.deviceId}`)
  }
  return lines
}

function formatCriticalIssues(healthStatus: HealthStatus): string[] {
  const lines: string[] = []
  if (
    !healthStatus.lastError &&
    healthStatus.device !== 'error' &&
    healthStatus.playback !== 'error' &&
    healthStatus.playback !== 'stalled'
  ) {
    return lines
  }

  lines.push('--- CRITICAL ISSUES ---')
  if (healthStatus.lastError) {
    lines.push(`Last Error: ${healthStatus.lastError}`)
    if (healthStatus.lastErrorTimestamp) {
      lines.push(
        `Error Timestamp: ${formatAbsoluteTime(healthStatus.lastErrorTimestamp)}`
      )
    }
  }
  if (healthStatus.device === 'error') {
    lines.push('Device Error: Device connection has failed')
  }
  if (healthStatus.playback === 'error') {
    lines.push('Playback Error: Playback has encountered an error')
  }
  if (healthStatus.playback === 'stalled') {
    lines.push('Playback Stalled: Playback has stopped making progress')
  }
  if (healthStatus.failureMetrics?.consecutiveFailures) {
    lines.push(
      `Consecutive Failures: ${healthStatus.failureMetrics.consecutiveFailures}`
    )
    if (healthStatus.failureMetrics.lastFailureTimestamp) {
      lines.push(
        `Last Failure: ${formatAbsoluteTime(healthStatus.failureMetrics.lastFailureTimestamp)}`
      )
    }
  }
  return lines
}

function formatPlaybackDetails(healthStatus: HealthStatus): string[] {
  const lines: string[] = []
  if (!healthStatus.playbackDetails) {
    return lines
  }

  lines.push('--- PLAYBACK STATE ---')
  if (healthStatus.playbackDetails.currentTrack) {
    lines.push(
      `Current Track: ${healthStatus.playbackDetails.currentTrack.name}`
    )
    lines.push(`Artist: ${healthStatus.playbackDetails.currentTrack.artist}`)
    lines.push(`Track ID: ${healthStatus.playbackDetails.currentTrack.id}`)
  } else {
    lines.push('Current Track: No track currently playing')
  }
  if (healthStatus.playbackDetails.progress !== undefined) {
    lines.push(
      `Progress: ${formatDuration(healthStatus.playbackDetails.progress)}`
    )
  }
  if (healthStatus.playbackDetails.duration !== undefined) {
    lines.push(
      `Duration: ${formatDuration(healthStatus.playbackDetails.duration)}`
    )
  }
  lines.push(`Is Playing: ${healthStatus.playbackDetails.isPlaying}`)
  if (healthStatus.playbackDetails.isStalled) {
    lines.push('Status: STALLED')
  }
  return lines
}

function formatQueueState(healthStatus: HealthStatus): string[] {
  const lines: string[] = []
  if (!healthStatus.queueState) {
    return lines
  }

  lines.push('--- QUEUE INFORMATION ---')
  lines.push(`Queue Length: ${healthStatus.queueState.queueLength} tracks`)
  lines.push(`Is Empty: ${healthStatus.queueState.isEmpty}`)
  lines.push(`Has Next Track: ${healthStatus.queueState.hasNextTrack}`)
  if (healthStatus.queueState.nextTrack) {
    lines.push(`Next Track: ${healthStatus.queueState.nextTrack.name}`)
    lines.push(`Next Track Artist: ${healthStatus.queueState.nextTrack.artist}`)
    lines.push(`Next Track ID: ${healthStatus.queueState.nextTrack.id}`)
    lines.push(
      `Next Track Queue ID: ${healthStatus.queueState.nextTrack.queueId}`
    )
  } else {
    lines.push('Next Track: No next track in queue')
  }
  return lines
}

function formatRecentEvents(healthStatus: HealthStatus): string[] {
  const lines: string[] = []
  if (!healthStatus.recentEvents || healthStatus.recentEvents.length === 0) {
    return lines
  }

  lines.push('--- RECENT EVENTS ---')
  healthStatus.recentEvents.forEach((event, index) => {
    lines.push(
      `[${index + 1}] ${formatEventType(event.type).toUpperCase()} - ${(event.severity ?? 'info').toUpperCase()}`
    )
    lines.push(`  Time: ${formatAbsoluteTime(event.timestamp)}`)
    lines.push(`  Message: ${event.message}`)
    if (event.details && Object.keys(event.details).length > 0) {
      lines.push(
        `  Details: ${JSON.stringify(event.details, null, 2).split('\n').join('\n    ')}`
      )
    }
    lines.push('')
  })
  return lines
}

function formatTechnicalDetails(
  healthStatus: HealthStatus,
  currentPlayerStatus: string
): string[] {
  const lines: string[] = []
  lines.push('--- TECHNICAL DETAILS ---')
  lines.push(`Player Status (Internal): ${currentPlayerStatus}`)
  if (healthStatus.failureMetrics) {
    lines.push(
      `Consecutive Failures: ${healthStatus.failureMetrics.consecutiveFailures}`
    )
    if (healthStatus.failureMetrics.lastSuccessfulOperation) {
      lines.push(
        `Last Recovery: ${formatAbsoluteTime(healthStatus.failureMetrics.lastSuccessfulOperation)}`
      )
    }
    if (healthStatus.failureMetrics.lastFailureTimestamp) {
      lines.push(
        `Last Failure: ${formatAbsoluteTime(healthStatus.failureMetrics.lastFailureTimestamp)}`
      )
    }
  }

  if (healthStatus.internalState) {
    lines.push('')
    lines.push('--- INTERNAL STATE ---')
    lines.push(`Auth Retry Count: ${healthStatus.internalState.authRetryCount}`)
    lines.push(
      `Active Timeouts: ${healthStatus.internalState.activeTimeouts.length > 0 ? healthStatus.internalState.activeTimeouts.join(', ') : 'None'}`
    )
  }
  return lines
}

export function formatDiagnosticsForClipboard(
  healthStatus: HealthStatus,
  isReady: boolean,
  playerStatus: PlayerStatus | undefined,
  currentPlayerStatus: string
): string {
  const lines: string[] = []

  lines.push('=== SYSTEM DIAGNOSTICS ===')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  const systemInfo = formatSystemInfo(healthStatus)
  if (systemInfo.length > 0) {
    lines.push(...systemInfo)
    lines.push('')
  }

  lines.push(...formatSystemStatus(healthStatus, playerStatus, isReady))
  lines.push('')

  const criticalIssues = formatCriticalIssues(healthStatus)
  if (criticalIssues.length > 0) {
    lines.push(...criticalIssues)
    lines.push('')
  }

  const playbackDetails = formatPlaybackDetails(healthStatus)
  if (playbackDetails.length > 0) {
    lines.push(...playbackDetails)
    lines.push('')
  }

  const queueState = formatQueueState(healthStatus)
  if (queueState.length > 0) {
    lines.push(...queueState)
    lines.push('')
  }

  const recentEvents = formatRecentEvents(healthStatus)
  if (recentEvents.length > 0) {
    lines.push(...recentEvents)
  }

  lines.push(...formatTechnicalDetails(healthStatus, currentPlayerStatus))

  return lines.join('\n')
}
