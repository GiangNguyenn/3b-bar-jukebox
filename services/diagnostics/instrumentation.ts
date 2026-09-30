/**
 * Browser-side wiring for remote diagnostics (see docs/remote-diagnostics.md).
 *
 * installDiagnostics() is called once a venue owner is signed in (see
 * components/RemoteLogBridge.tsx). From then on it records things the app's
 * own logger never sees — raw console output, failed network requests,
 * connection and tab-lifecycle changes — sends a heartbeat, and asks the
 * anomaly detector for a snapshot whenever something looks wrong.
 */
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { recoveryManager } from '@/services/player/recoveryManager'
import { tokenManager } from '@/shared/token/tokenManager'
import {
  remoteLogShipper,
  isConsoleTapSuppressed
} from '@/shared/utils/remoteLogShipper'
import { AnomalyDetector, type SnapshotSeverity } from './anomalyDetector'
import {
  describeRequest,
  failureLevel,
  formatConsoleArgs,
  isOutageFailure,
  percentile,
  type RequestInfoSummary
} from './helpers'

const DIAGNOSTICS_PATH = '/api/diagnostics'
const SLOW_REQUEST_MS = 5_000
const OUTAGE_FAILURE_COUNT = 3
const OUTAGE_WINDOW_MS = 60_000
const HEARTBEAT_INTERVAL_MS = 5 * 60_000
const DRIFT_CHECK_INTERVAL_MS = 5_000
const DRIFT_THRESHOLD_MS = 15_000
// A hidden, silent tab is throttled by the browser as a matter of course;
// only a gap this long (laptop asleep) is worth flagging there.
const HIDDEN_DRIFT_THRESHOLD_MS = 5 * 60_000
const PLAYER_STUCK_MS = 30_000
const MAX_DURATION_SAMPLES = 50
const ERROR_BODY_LENGTH = 500

type SnapshotBuilder = () => Record<string, unknown>

interface HostStats {
  count: number
  failures: number
  durations: number[]
  failureTimes: number[]
}

let installed = false
let fullSnapshotBuilder: SnapshotBuilder | null = null
const hostStats = new Map<string, HostStats>()
const longTasks = { count: 0, totalMs: 0 }

export const anomalyDetector = new AnomalyDetector({ capture: captureSnapshot })

/**
 * The admin page registers a builder for the full diagnostics snapshot.
 * Without one (any other page) a reduced snapshot is built from the player
 * singletons, which keep running across route changes.
 */
export function registerSnapshotBuilder(builder: SnapshotBuilder): () => void {
  fullSnapshotBuilder = builder
  return () => {
    if (fullSnapshotBuilder === builder) fullSnapshotBuilder = null
  }
}

function captureSnapshot(
  trigger: string,
  detail: string | undefined,
  severity: SnapshotSeverity
): void {
  // Upload the lead-up (INFO lines) alongside the snapshot
  remoteLogShipper.flushRecorder()

  let data: Record<string, unknown>
  try {
    data = fullSnapshotBuilder ? fullSnapshotBuilder() : buildReducedSnapshot()
  } catch (error) {
    data = {
      kind: 'failed',
      error: error instanceof Error ? error.message : String(error)
    }
  }

  remoteLogShipper.queueSnapshot({
    trigger,
    detail,
    severity,
    data: {
      ...data,
      network: getNetworkStats(),
      performance: getPerformanceInfo()
    }
  })
}

function buildReducedSnapshot(): Record<string, unknown> {
  const player = spotifyPlayerStore.getState()
  return {
    kind: 'reduced',
    summary: {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      visibility: document.visibilityState
    },
    player: getPlayerSummary(),
    lastError: player.lastError,
    consecutiveFailures: player.consecutiveFailures,
    internalState: playerLifecycleService.getDiagnostics(),
    recoveryState: recoveryManager.getDiagnostics(),
    tokenTimestamps: tokenManager.getTokenTimestamps()
  }
}

function getPlayerSummary(): Record<string, unknown> {
  const player = spotifyPlayerStore.getState()
  return {
    status: player.status,
    lastStatusChange: player.lastStatusChange || undefined,
    hasDevice: player.deviceId !== null,
    isPlaying: player.playbackState?.is_playing,
    track: player.playbackState?.item?.name
  }
}

function getNetworkStats(): Record<string, unknown> {
  const stats: Record<string, unknown> = {}
  hostStats.forEach((value, host) => {
    stats[host] = {
      requests: value.count,
      failures: value.failures,
      p95Ms: Math.round(percentile(value.durations, 0.95))
    }
  })
  return stats
}

function getPerformanceInfo(): Record<string, unknown> {
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory
  return {
    uptimeSeconds: Math.round(performance.now() / 1000),
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1_048_576) : undefined,
    longTasks: longTasks.count,
    longTaskMs: Math.round(longTasks.totalMs)
  }
}

function getConnectionInfo(): Record<string, unknown> | undefined {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number }
    }
  ).connection
  if (!connection) return undefined
  return {
    effectiveType: connection.effectiveType,
    downlink: connection.downlink,
    rtt: connection.rtt
  }
}

// ─── Console ────────────────────────────────────────────────────────────────

function installConsoleTap(): void {
  const levels = { warn: 'WARN', error: 'ERROR' } as const
  ;(['warn', 'error'] as const).forEach((method) => {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]): void => {
      original(...args)
      if (isConsoleTapSuppressed()) return
      try {
        const { context, message, error } = formatConsoleArgs(args)
        remoteLogShipper.enqueue({
          level: levels[method],
          context: context ?? 'Console',
          message,
          error
        })
      } catch {
        // Never let diagnostics break a console call
      }
    }
  })
}

// ─── Network ────────────────────────────────────────────────────────────────

function getHostStats(host: string): HostStats {
  let stats = hostStats.get(host)
  if (!stats) {
    stats = { count: 0, failures: 0, durations: [], failureTimes: [] }
    hostStats.set(host, stats)
  }
  return stats
}

function recordRequest(
  request: RequestInfoSummary,
  durationMs: number,
  status: number | null,
  extra: { errorName?: string; retryAfter?: string | null; body?: string }
): void {
  const stats = getHostStats(request.host)
  stats.count++
  stats.durations.push(durationMs)
  if (stats.durations.length > MAX_DURATION_SAMPLES) stats.durations.shift()

  const failed = status === null || status >= 400
  const slow = durationMs > SLOW_REQUEST_MS
  if (!failed && !slow) return

  if (failed) stats.failures++

  const duration = Math.round(durationMs)
  const outcome = status ?? extra.errorName ?? 'failed'
  remoteLogShipper.enqueue({
    level: failed ? failureLevel(status, extra.errorName) : 'INFO',
    context: 'Network',
    message: `${request.method} ${request.host}${request.path} → ${outcome}${slow ? ' (slow)' : ''}`,
    details: {
      method: request.method,
      host: request.host,
      path: request.path,
      status,
      durationMs: duration,
      errorName: extra.errorName,
      retryAfter: extra.retryAfter ?? undefined,
      body: extra.body
    }
  })

  if (failed && isOutageFailure(status, extra.errorName)) {
    const now = Date.now()
    stats.failureTimes = stats.failureTimes.filter(
      (at) => now - at < OUTAGE_WINDOW_MS
    )
    stats.failureTimes.push(now)
    if (stats.failureTimes.length >= OUTAGE_FAILURE_COUNT) {
      stats.failureTimes = []
      anomalyDetector.report(
        'offline',
        `${OUTAGE_FAILURE_COUNT} failed requests to ${request.host} within a minute`,
        'error'
      )
    }
  }
}

function installFetchTap(): void {
  const originalFetch = window.fetch.bind(window)
  const origin = window.location.origin

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const request = describeRequest(input, init, origin)
    // Don't record our own uploads: a failing upload would log a failure,
    // which would need uploading.
    if (request.sameOrigin && request.path.startsWith(DIAGNOSTICS_PATH)) {
      return originalFetch(input, init)
    }

    const startedAt = performance.now()
    let response: Response
    try {
      response = await originalFetch(input, init)
    } catch (error) {
      recordRequest(request, performance.now() - startedAt, null, {
        errorName: error instanceof Error ? error.name : 'Error'
      })
      throw error
    }

    const durationMs = performance.now() - startedAt
    try {
      const retryAfter = response.headers.get('Retry-After')
      if (!response.ok && request.sameOrigin) {
        // Our own routes put the server-side error message in the body
        void response
          .clone()
          .text()
          .catch(() => '')
          .then((body) => {
            recordRequest(request, durationMs, response.status, {
              retryAfter,
              body: body.slice(0, ERROR_BODY_LENGTH) || undefined
            })
          })
      } else {
        recordRequest(request, durationMs, response.status, { retryAfter })
      }
    } catch {
      // Recording must never affect the request itself
    }
    return response
  }
}

// ─── Connection and tab lifecycle ───────────────────────────────────────────

function logLifecycle(
  level: 'INFO' | 'WARN',
  message: string,
  details?: Record<string, unknown>
): void {
  remoteLogShipper.enqueue({ level, context: 'Lifecycle', message, details })
}

function installLifecycleListeners(): void {
  window.addEventListener('offline', () => {
    remoteLogShipper.enqueue({
      level: 'WARN',
      context: 'Network',
      message: 'Browser went offline'
    })
    anomalyDetector.setCondition('offline', true, 'Browser reports offline')
  })
  window.addEventListener('online', () => {
    remoteLogShipper.enqueue({
      level: 'INFO',
      context: 'Network',
      message: 'Browser back online',
      details: getConnectionInfo()
    })
    anomalyDetector.setCondition('offline', false)
    void remoteLogShipper.flush()
  })

  const connection = (navigator as Navigator & { connection?: EventTarget })
    .connection
  connection?.addEventListener('change', () => {
    remoteLogShipper.enqueue({
      level: 'INFO',
      context: 'Network',
      message: 'Connection changed',
      details: getConnectionInfo()
    })
  })

  document.addEventListener('visibilitychange', () => {
    logLifecycle('INFO', `Tab ${document.hidden ? 'hidden' : 'visible'}`)
    if (document.hidden) remoteLogShipper.flushOnUnload()
  })
  window.addEventListener('pagehide', () => {
    remoteLogShipper.flushOnUnload()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      logLifecycle('INFO', 'Page restored from back/forward cache')
    }
  })
  document.addEventListener('freeze', () => {
    logLifecycle('INFO', 'Tab frozen by the browser')
  })
  document.addEventListener('resume', () => {
    logLifecycle('WARN', 'Tab resumed after being frozen by the browser')
  })

  if ((document as Document & { wasDiscarded?: boolean }).wasDiscarded) {
    logLifecycle('WARN', 'Tab was discarded by the browser and reloaded')
  }
}

// Detects the main thread not running: a sleeping laptop, a frozen or
// heavily throttled tab, or a long blocking task.
function installTimerDriftCheck(): void {
  let lastTick = Date.now()
  setInterval(() => {
    const now = Date.now()
    const gapMs = now - lastTick - DRIFT_CHECK_INTERVAL_MS
    lastTick = now
    if (gapMs < DRIFT_THRESHOLD_MS) return

    const seconds = Math.round(gapMs / 1000)
    if (document.hidden && gapMs < HIDDEN_DRIFT_THRESHOLD_MS) {
      logLifecycle('INFO', 'Main thread paused while tab hidden', { gapMs })
      return
    }
    logLifecycle('WARN', `Main thread paused for ${seconds}s`, {
      gapMs,
      hidden: document.hidden
    })
    anomalyDetector.report(
      'timer_gap',
      `Main thread paused for ${seconds}s`,
      'warning'
    )
  }, DRIFT_CHECK_INTERVAL_MS)
}

function installLongTaskObserver(): void {
  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        longTasks.count++
        longTasks.totalMs += entry.duration
      })
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    // Not supported in this browser
  }
}

// ─── Player ─────────────────────────────────────────────────────────────────

function installPlayerWatch(): void {
  spotifyPlayerStore.subscribe((state, previous) => {
    if (state.status !== previous.status) {
      // lastStatusChange stays 0 on pages that never create a player, where
      // the store just sits on its initial 'initializing'
      const stuck = state.status !== 'ready' && state.lastStatusChange > 0
      anomalyDetector.setCondition(
        'player_stuck',
        stuck,
        `Player status ${state.status}${state.lastError ? `: ${state.lastError}` : ''}`,
        { sustainMs: PLAYER_STUCK_MS }
      )
    }
    if (state.recoveryRequested && !previous.recoveryRequested) {
      anomalyDetector.report(
        'recovery_attempt',
        'Spotify device lost; player is being rebuilt',
        'error'
      )
    }
  })

  recoveryManager.onSuspensionChange((suspended) => {
    anomalyDetector.setCondition(
      'token_suspended',
      suspended,
      'Token recovery exhausted; dependent services suspended'
    )
  })
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

function sendHeartbeat(): void {
  remoteLogShipper.setHeartbeat({
    userAgent: navigator.userAgent,
    state: {
      player: getPlayerSummary(),
      online: navigator.onLine,
      visibility: document.visibilityState,
      connection: getConnectionInfo(),
      performance: getPerformanceInfo(),
      buffers: remoteLogShipper.getQueueSizes()
    }
  })
}

export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  remoteLogShipper.onEntry((entry) => {
    anomalyDetector.observeLog(entry)
  })

  installConsoleTap()
  installFetchTap()
  installLifecycleListeners()
  installTimerDriftCheck()
  installLongTaskObserver()
  installPlayerWatch()

  sendHeartbeat()
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
}
