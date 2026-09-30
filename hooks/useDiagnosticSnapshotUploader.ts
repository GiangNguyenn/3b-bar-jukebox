'use client'

import { useEffect, useRef } from 'react'
import type { HealthStatus } from '@/shared/types/health'
import type { PlayerStatus } from './spotifyPlayerStore'
import type { LogEntry } from './ConsoleLogsProvider'
import {
  anomalyDetector,
  registerSnapshotBuilder
} from '@/services/diagnostics/instrumentation'
import {
  buildDiagnosticsData,
  hasErrorStatus
} from '@/app/[username]/admin/components/dashboard/components/diagnostic-utils'

// Health checks can briefly report an error while the player starts up or
// recovers by itself; only a state that lasts is worth a snapshot.
const ERROR_SUSTAIN_MS = 10_000
const DEGRADED_SUSTAIN_MS = 30_000

function describeHealthError(health: HealthStatus): string {
  const parts: string[] = []
  if (health.lastError) parts.push(health.lastError)
  if (health.device === 'error' || health.device === 'disconnected') {
    parts.push(`device ${health.device}`)
  }
  if (health.playback === 'error' || health.playback === 'stalled') {
    parts.push(`playback ${health.playback}`)
  }
  if (health.token === 'error') parts.push('token error')
  if (health.connection === 'disconnected') parts.push('connection lost')
  const failures = health.failureMetrics?.consecutiveFailures ?? 0
  if (failures > 0) parts.push(`${failures} consecutive failures`)
  return parts.join('; ')
}

function describeDegraded(health: HealthStatus): string | null {
  const parts: string[] = []
  if (health.device === 'unresponsive') parts.push('device unresponsive')
  if (health.connection === 'poor' || health.connection === 'unstable') {
    parts.push(`connection ${health.connection}`)
  }
  return parts.length > 0 ? parts.join('; ') : null
}

/**
 * Uploads the diagnostics panel's data automatically when the jukebox's
 * health goes wrong, so nobody at the venue has to press "Copy Diagnostics"
 * (see docs/remote-diagnostics.md).
 */
export function useDiagnosticSnapshotUploader(
  healthStatus: HealthStatus,
  isReady: boolean,
  playerStatus: PlayerStatus,
  logs: LogEntry[]
): void {
  const latest = useRef({ healthStatus, isReady, playerStatus, logs })
  latest.current = { healthStatus, isReady, playerStatus, logs }

  useEffect(() => {
    const unregister = registerSnapshotBuilder(() => {
      const current = latest.current
      return {
        kind: 'full',
        ...buildDiagnosticsData(
          current.healthStatus,
          current.isReady,
          current.playerStatus,
          current.playerStatus,
          current.logs
        )
      }
    })
    return () => {
      unregister()
      // Leaving the page is not a recovery
      anomalyDetector.clearCondition('health_error')
      anomalyDetector.clearCondition('health_degraded')
    }
  }, [])

  const hasErrors = hasErrorStatus(healthStatus)
  const errorDetail = hasErrors ? describeHealthError(healthStatus) : undefined
  useEffect(() => {
    anomalyDetector.setCondition('health_error', hasErrors, errorDetail, {
      sustainMs: ERROR_SUSTAIN_MS
    })
  }, [hasErrors, errorDetail])

  const degradedDetail = describeDegraded(healthStatus)
  useEffect(() => {
    anomalyDetector.setCondition(
      'health_degraded',
      degradedDetail !== null,
      degradedDetail ?? undefined,
      { sustainMs: DEGRADED_SUSTAIN_MS, severity: 'warning' }
    )
  }, [degradedDetail])
}
