import type { HealthStatus } from '@/shared/types/health'
import type { PlayerStatus } from '@/hooks/useSpotifyPlayer'
import type {
  FailedRequestInfo,
  ConnectivityInvestigation
} from '@/shared/types/connectivity'
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

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}h ${m}m ${s}s`
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
  if (systemInfo.uptime !== undefined) {
    lines.push(`System Uptime: ${formatUptime(systemInfo.uptime)}`)
  }
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
    if (
      healthStatus.internalState.internalLogs &&
      healthStatus.internalState.internalLogs.length > 0
    ) {
      lines.push('')
      lines.push('--- INTERNAL LOGS ---')
      healthStatus.internalState.internalLogs.forEach((log) => {
        lines.push(
          `[${formatAbsoluteTime(log.timestamp)}] [${log.level}] ${log.message}`
        )
        if (log.details) {
          lines.push(
            `  Details: ${JSON.stringify(log.details, null, 2).split('\n').join('\n    ')}`
          )
        }
      })
    }

    lines.push('')
    lines.push('--- INTERNAL STATE ---')
    lines.push(`Auth Retry Count: ${healthStatus.internalState.authRetryCount}`)
    lines.push(
      `Active Timeouts: ${healthStatus.internalState.activeTimeouts.length > 0 ? healthStatus.internalState.activeTimeouts.join(', ') : 'None'}`
    )
  }
  return lines
}

function formatConnectivityInvestigation(healthStatus: HealthStatus): string[] {
  const lines: string[] = []
  if (!healthStatus.connectivityInvestigation) {
    return lines
  }

  const {
    protocolStatus,
    suspectedIssues,
    lastInvestigation,
    recentFailures
  }: ConnectivityInvestigation = healthStatus.connectivityInvestigation
  lines.push('--- CONNECTIVITY INVESTIGATION ---')

  // Protocol Status
  lines.push('Protocol Status:')
  lines.push(
    `  IPv4: ${protocolStatus.ipv4.tested ? (protocolStatus.ipv4.available ? '✓ Available' : '✗ Unavailable') : 'Not Tested'}${protocolStatus.ipv4.latency ? ` (${protocolStatus.ipv4.latency}ms)` : ''}`
  )
  if (protocolStatus.ipv4.error) {
    lines.push(`    Error: ${protocolStatus.ipv4.error}`)
  }
  lines.push(
    `  IPv6: ${protocolStatus.ipv6.tested ? (protocolStatus.ipv6.available ? '✓ Available' : '✗ Unavailable') : 'Not Tested'}${protocolStatus.ipv6.latency ? ` (${protocolStatus.ipv6.latency}ms)` : ''}`
  )
  if (protocolStatus.ipv6.error) {
    lines.push(`    Error: ${protocolStatus.ipv6.error}`)
  }
  lines.push(`  Last Tested: ${formatAbsoluteTime(protocolStatus.lastTested)}`)

  // Suspected Issues
  if (suspectedIssues.length > 0) {
    lines.push('')
    lines.push('Suspected Issues:')
    suspectedIssues.forEach((issue: string) => {
      lines.push(`  - ${issue}`)
    })
  }

  // Last Investigation
  if (lastInvestigation) {
    lines.push('')
    lines.push('Last Investigation:')
    lines.push(`  Time: ${formatAbsoluteTime(lastInvestigation.timestamp)}`)
    lines.push(
      `  Failed Request: ${lastInvestigation.trigger.method} ${lastInvestigation.trigger.url}`
    )
    lines.push(`  Error: ${lastInvestigation.trigger.error}`)
    lines.push(`  Error Type: ${lastInvestigation.trigger.errorType}`)

    if (lastInvestigation.recommendations.length > 0) {
      lines.push('  Recommendations:')
      lastInvestigation.recommendations.forEach((rec: string) => {
        lines.push(`    - ${rec}`)
      })
    }
  }

  // Recent Failures
  if (recentFailures.length > 0) {
    lines.push('')
    lines.push(`Recent Failed Requests (${recentFailures.length}):`)
    recentFailures
      .slice(0, 5)
      .forEach((failure: FailedRequestInfo, index: number) => {
        lines.push(`  [${index + 1}] ${failure.method} ${failure.url}`)
        lines.push(`      Time: ${formatAbsoluteTime(failure.timestamp)}`)
        lines.push(`      Error: ${failure.error}`)
      })
    if (recentFailures.length > 5) {
      lines.push(`  ... and ${recentFailures.length - 5} more`)
    }
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

  const connectivityInvestigation =
    formatConnectivityInvestigation(healthStatus)
  if (connectivityInvestigation.length > 0) {
    lines.push(...connectivityInvestigation)
    lines.push('')
  }

  lines.push(...formatTechnicalDetails(healthStatus, currentPlayerStatus))

  if (
    healthStatus.internalState?.internalLogs &&
    healthStatus.internalState.internalLogs.length > 0
  ) {
    lines.push('')
    lines.push('--- INTERNAL LOGS ---')
    healthStatus.internalState.internalLogs.forEach((log) => {
      lines.push(
        `[${formatAbsoluteTime(log.timestamp)}] [${log.level}] ${log.message}`
      )
      if (log.details) {
        lines.push(
          `  Details: ${JSON.stringify(log.details, null, 2).split('\n').join('\n    ')}`
        )
      }
    })
  }

  return lines.join('\n')
}
