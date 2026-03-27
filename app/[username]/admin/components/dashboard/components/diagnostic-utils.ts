import type { HealthStatus, DiagnosticEvent } from '@/shared/types/health'
import type { PlayerStatus } from '@/hooks/useSpotifyPlayer'

import { formatAbsoluteTime } from '@/lib/utils'
import { tokenManager } from '@/shared/token/tokenManager'
import { recoveryManager } from '@/services/player/recoveryManager'

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

/**
 * Summarize error/warn counts by context module from console logs.
 * Helps quickly identify which subsystem is failing most.
 */
function summarizeErrorCounts(
  logs: ConsoleLogEntry[]
): Record<string, { errors: number; warnings: number }> {
  const counts: Record<string, { errors: number; warnings: number }> = {}
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'WARN') continue
    const key = log.context ?? 'Unknown'
    if (!counts[key]) counts[key] = { errors: 0, warnings: 0 }
    if (log.level === 'ERROR') counts[key].errors++
    else counts[key].warnings++
  }
  return counts
}

/**
 * Detect operations that failed repeatedly for the same target (e.g. same track ID).
 * Returns groups of repeated failure patterns.
 */
function detectRepeatedFailures(logs: ConsoleLogEntry[]): Array<{
  pattern: string
  count: number
  firstSeen: string
  lastSeen: string
}> {
  // Extract failure signatures: context + key identifiers from message
  const failureMap = new Map<
    string,
    { count: number; firstSeen: string; lastSeen: string }
  >()

  for (const log of logs) {
    if (log.level !== 'ERROR') continue
    // Normalize the message to group related failures
    // Strip attempt numbers and timestamps to find the core operation
    const normalized = log.message
      .replace(/\(attempt \d+\/\d+\)/g, '')
      .replace(/after \d+ attempts/g, 'after N attempts')
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<uuid>'
      )
      .trim()
    const key = `[${log.context ?? 'Unknown'}] ${normalized}`

    const existing = failureMap.get(key)
    const ts = log.timestamp
    if (existing) {
      existing.count++
      existing.lastSeen = ts
    } else {
      failureMap.set(key, { count: 1, firstSeen: ts, lastSeen: ts })
    }
  }

  // Only return patterns that repeated
  return Array.from(failureMap.entries())
    .filter(([, v]) => v.count > 1)
    .map(([pattern, v]) => ({
      pattern,
      count: v.count,
      firstSeen: v.firstSeen.split('T')[1]?.slice(0, 12) ?? v.firstSeen,
      lastSeen: v.lastSeen.split('T')[1]?.slice(0, 12) ?? v.lastSeen
    }))
}

/**
 * Get the time span covered by the captured logs.
 */
function getLogTimeSpan(
  logs: ConsoleLogEntry[]
): { oldest: string; newest: string; durationMinutes: number } | undefined {
  if (logs.length === 0) return undefined
  const oldest = logs[logs.length - 1]?.timestamp
  const newest = logs[0]?.timestamp
  if (!oldest || !newest) return undefined
  const durationMs = new Date(newest).getTime() - new Date(oldest).getTime()
  return {
    oldest: oldest.split('T')[1]?.slice(0, 12) ?? oldest,
    newest: newest.split('T')[1]?.slice(0, 12) ?? newest,
    durationMinutes: Math.round(durationMs / 60000)
  }
}

/**
 * Token-related keywords used to identify root cause errors in events and logs.
 */
const TOKEN_KEYWORDS = /token|refresh|401|auth|expired/i

/**
 * Deduplicate consecutive identical diagnostic events.
 * Collapses runs of events with the same message into a single entry
 * with count and time range.
 */
function deduplicateEvents(
  events: DiagnosticEvent[]
): Array<{
  message: string
  count: number
  firstSeen: number
  lastSeen: number
}> {
  if (events.length === 0) return []

  const result: Array<{
    message: string
    count: number
    firstSeen: number
    lastSeen: number
  }> = []

  let current = {
    message: events[0].message,
    count: 1,
    firstSeen: events[0].timestamp,
    lastSeen: events[0].timestamp
  }

  for (let i = 1; i < events.length; i++) {
    const event = events[i]
    if (event.message === current.message) {
      current.count++
      current.lastSeen = event.timestamp
    } else {
      result.push(current)
      current = {
        message: event.message,
        count: 1,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp
      }
    }
  }
  result.push(current)

  return result
}

/**
 * Build root cause analysis from recent events and console logs.
 * Identifies the earliest token-related error and constructs a causal chain.
 */
function buildRootCauseAnalysis(
  events: DiagnosticEvent[],
  logs: ConsoleLogEntry[]
): {
  earliestTokenError: { message: string; timestamp: number } | null
  causalChain: string[]
  tokenTimestamps: { lastSuccessfulRefresh?: number; tokenExpiryTime?: number }
  endpointFailures: Array<{
    endpoint: string
    httpStatus: number
    errorCode?: string
    errorMessage?: string
    timestamp: number
  }>
} {
  // Find earliest token-related error in events
  let earliestTokenError: { message: string; timestamp: number } | null = null
  for (const event of events) {
    if (TOKEN_KEYWORDS.test(event.message)) {
      if (
        !earliestTokenError ||
        event.timestamp < earliestTokenError.timestamp
      ) {
        earliestTokenError = {
          message: event.message,
          timestamp: event.timestamp
        }
      }
    }
  }

  // Also check logs for earlier token errors
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'WARN') continue
    if (!TOKEN_KEYWORDS.test(log.message)) continue
    const logTs = new Date(log.timestamp).getTime()
    if (isNaN(logTs)) continue
    if (!earliestTokenError || logTs < earliestTokenError.timestamp) {
      earliestTokenError = { message: log.message, timestamp: logTs }
    }
  }

  // Build causal chain: token failure → downstream cascade
  const causalChain: string[] = []
  if (earliestTokenError) {
    causalChain.push(
      `Token failure: ${earliestTokenError.message} at ${new Date(earliestTokenError.timestamp).toISOString()}`
    )

    // Look for downstream errors that occurred after the token failure
    const downstreamErrors = new Set<string>()
    for (const event of events) {
      if (
        event.timestamp > earliestTokenError.timestamp &&
        !TOKEN_KEYWORDS.test(event.message)
      ) {
        downstreamErrors.add(event.message)
      }
    }
    Array.from(downstreamErrors).forEach((msg) => {
      causalChain.push(`Downstream cascade: ${msg}`)
    })
  }

  // Get token timestamps and endpoint failure details
  const tokenTimestamps = tokenManager.getTokenTimestamps()
  const recoveryDiag = recoveryManager.getDiagnostics()

  return {
    earliestTokenError,
    causalChain,
    tokenTimestamps,
    endpointFailures: recoveryDiag.lastFailureDetails
  }
}

export function formatDiagnosticsForClipboard(
  healthStatus: HealthStatus,
  isReady: boolean,
  playerStatus: PlayerStatus | undefined,
  currentPlayerStatus: string,
  logs: ConsoleLogEntry[] = []
): string {
  const hasErrors = hasErrorStatus(healthStatus)
  const hasWarnings = hasWarningStatus(healthStatus)
  const overallSeverity = getOverallSeverity(hasErrors, hasWarnings)

  const diagnosticData = {
    summary: {
      status: overallSeverity,
      timestamp: new Date().toISOString(),
      userAgent: healthStatus.systemInfo?.userAgent,
      uptime: healthStatus.systemInfo?.uptime,
      device: {
        status: healthStatus.device,
        id: healthStatus.deviceId,
        isReady: isReady
      },
      playback: {
        status: healthStatus.playback,
        isPlaying: healthStatus.playbackDetails?.isPlaying,
        currentTrack: healthStatus.playbackDetails?.currentTrack?.name,
        progress: healthStatus.playbackDetails?.progress,
        duration: healthStatus.playbackDetails?.duration,
        isStalled: healthStatus.playbackDetails?.isStalled
      },
      connection: {
        status: healthStatus.connection,
        type: healthStatus.systemInfo?.connectionType
      },
      queue: {
        length: healthStatus.queueState?.queueLength,
        isEmpty: healthStatus.queueState?.isEmpty,
        hasNext: healthStatus.queueState?.hasNextTrack
      }
    },
    criticalIssues: {
      // Prioritize active errors
      activeErrors: [
        healthStatus.lastError,
        healthStatus.device === 'error' ? 'Device Error' : null,
        healthStatus.playback === 'error' ? 'Playback Error' : null,
        healthStatus.token === 'error' ? 'Token Error' : null,
        healthStatus.failureMetrics?.consecutiveFailures &&
        healthStatus.failureMetrics.consecutiveFailures > 0
          ? `Consecutive Failures: ${healthStatus.failureMetrics.consecutiveFailures}`
          : null
      ].filter(Boolean),
      lastErrorTimestamp: healthStatus.lastErrorTimestamp
        ? formatAbsoluteTime(healthStatus.lastErrorTimestamp)
        : undefined,
      metrics: healthStatus.failureMetrics
    },
    systemState: {
      playerStatus: playerStatus ?? (isReady ? 'ready' : 'initializing'),
      internalPlayerStatus: currentPlayerStatus,
      tokenStatus: healthStatus.token,
      tokenExpiringSoon: healthStatus.tokenExpiringSoon
    },
    details: {
      playback: healthStatus.playbackDetails,
      queue: healthStatus.queueState,
      recentEvents: healthStatus.recentEvents,
      connectivity: healthStatus.connectivityInvestigation,
      internalState: healthStatus.internalState,
      systemInfo: healthStatus.systemInfo
    },
    errorAnalysis: {
      // Summarize error patterns from logs to make diagnosis easier
      errorCounts: summarizeErrorCounts(logs),
      // Detect repeated failures on the same operation
      repeatedFailures: detectRepeatedFailures(logs),
      // Time span of captured logs
      logTimeSpan: getLogTimeSpan(logs)
    },
    logs: {
      // Include both internal component logs and console logs
      // Limit console logs to relevant ones to avoid clipboard size issues
      console: logs
        .slice(0, 50)
        .map(
          (l) =>
            `[${l.level}] ${l.timestamp.split('T')[1].slice(0, 12)} ${l.context ? `[${l.context}] ` : ''}${l.message}`
        ),
      internal: healthStatus.internalState?.internalLogs?.map(
        (l) =>
          `[${l.level}] ${new Date(l.timestamp).toISOString().split('T')[1].slice(0, 12)} ${l.message}`
      )
    },
    // ─── Additive enrichment fields ─────────────────────────────────────
    rootCauseAnalysis: buildRootCauseAnalysis(
      healthStatus.recentEvents ?? [],
      logs
    ),
    deduplicatedEvents: deduplicateEvents(healthStatus.recentEvents ?? []),
    tokenRecovery: {
      disconnectedAt:
        healthStatus.connection === 'disconnected'
          ? ((healthStatus as unknown as Record<string, unknown>)
              .disconnectedAt ?? null)
          : null,
      recoveryState: recoveryManager.getDiagnostics()
    }
  }

  return JSON.stringify(diagnosticData, null, 2)
}
