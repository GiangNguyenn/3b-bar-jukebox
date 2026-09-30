/**
 * Decides when something unusual enough has happened to upload a diagnostic
 * snapshot (see docs/remote-diagnostics.md), and keeps that from turning
 * into a flood: triggers that land together are merged into one snapshot,
 * each trigger type has a cooldown, and there are hourly caps.
 *
 * Triggers that mean the music has stopped or the player is being rebuilt
 * (PRIORITY_TRIGGERS) have an hourly budget of their own, so a burst of
 * routine warnings can never use up the snapshots needed for a real failure.
 *
 * Pure logic with injected timers; the wiring to the browser and the player
 * lives in ./instrumentation.ts.
 */

export type SnapshotSeverity = 'info' | 'warning' | 'error'

export type CaptureSnapshot = (
  trigger: string,
  detail: string | undefined,
  severity: SnapshotSeverity
) => void

export interface AnomalyDetectorOptions {
  capture: CaptureSnapshot
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface ObservedLog {
  level: 'INFO' | 'WARN' | 'ERROR'
  message: string
  context?: string
}

export const ANOMALY_CONFIG = {
  // Wait before capturing so the state settles and the follow-on logs exist
  SETTLE_MS: 5_000,
  COOLDOWN_MS: 60_000,
  // Routine triggers share this budget...
  MAX_SNAPSHOTS_PER_HOUR: 10,
  // ...and no single one of them may take more than this share of it
  MAX_PER_TRIGGER_PER_HOUR: 4,
  // Triggers that fire on log volume alone say the least per snapshot
  MAX_PER_NOISY_TRIGGER_PER_HOUR: 2,
  // Priority triggers draw on a separate budget
  MAX_PRIORITY_SNAPSHOTS_PER_HOUR: 10,
  STILL_UNHEALTHY_MS: 15 * 60_000,
  WARN_BURST_COUNT: 5,
  WARN_BURST_WINDOW_MS: 60_000
} as const

const HOUR_MS = 60 * 60_000
const SEVERITY_RANK: Record<SnapshotSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2
}
const REALTIME_DOWN_PATTERN = /CHANNEL_ERROR|TIMED_OUT/

/** Playback has stopped, or the player is broken or being rebuilt. */
export const PRIORITY_TRIGGERS: ReadonlySet<string> = new Set([
  'playback_stopped',
  'recovery_attempt',
  'player_stuck',
  'health_error',
  'token_suspended',
  'still_unhealthy',
  'recovered'
])
const NOISY_TRIGGERS: ReadonlySet<string> = new Set([
  'warn_burst',
  'realtime_down'
])

interface CaptureRecord {
  at: number
  trigger: string
  priority: boolean
}

interface PendingSnapshot {
  trigger: string
  detail: string | undefined
  severity: SnapshotSeverity
  also: string[]
}

interface ConditionState {
  detail: string | undefined
  active: boolean
  timer: unknown
}

export class AnomalyDetector {
  private readonly capture: CaptureSnapshot
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  private pending: PendingSnapshot | null = null
  private pendingTimer: unknown = null
  private lastFired = new Map<string, number>()
  private captures: CaptureRecord[] = []
  private warnTimes: number[] = []
  private conditions = new Map<string, ConditionState>()
  private stillUnhealthyTimer: unknown = null

  constructor(options: AnomalyDetectorOptions) {
    this.capture = options.capture
    this.now = options.now ?? ((): number => Date.now())
    this.setTimer =
      options.setTimer ?? ((fn, ms): unknown => setTimeout(fn, ms))
    this.clearTimer =
      options.clearTimer ??
      ((handle): void => {
        clearTimeout(handle as ReturnType<typeof setTimeout>)
      })
  }

  /**
   * Request a snapshot for a one-off event. Returns false when it was
   * suppressed by the cooldown or the hourly cap.
   */
  report(
    trigger: string,
    detail?: string,
    severity: SnapshotSeverity = 'error',
    cooldownKey: string = trigger
  ): boolean {
    const now = this.now()
    const last = this.lastFired.get(cooldownKey)
    if (last !== undefined && now - last < ANOMALY_CONFIG.COOLDOWN_MS) {
      return false
    }

    const priority = PRIORITY_TRIGGERS.has(trigger)
    this.captures = this.captures.filter((c) => now - c.at < HOUR_MS)

    if (this.pending) {
      // A snapshot is about to be taken anyway; note this trigger on it
      this.lastFired.set(cooldownKey, now)
      const pending = this.pending
      if (priority && !PRIORITY_TRIGGERS.has(pending.trigger)) {
        // The snapshot should be filed under the more serious trigger, and
        // counted against the priority budget rather than the routine one
        pending.also = [
          pending.trigger,
          ...pending.also.filter((other) => other !== trigger)
        ]
        pending.trigger = trigger
        pending.detail = detail
        const record = this.captures[this.captures.length - 1]
        if (record) {
          record.trigger = trigger
          record.priority = true
        }
      } else if (
        trigger !== pending.trigger &&
        !pending.also.includes(trigger)
      ) {
        pending.also.push(trigger)
      }
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[pending.severity]) {
        pending.severity = severity
      }
      return true
    }

    if (!this.hasBudget(trigger, priority)) {
      return false
    }

    this.lastFired.set(cooldownKey, now)
    this.captures.push({ at: now, trigger, priority })
    this.pending = { trigger, detail, severity, also: [] }
    this.pendingTimer = this.setTimer(() => {
      const pending = this.pending
      this.pending = null
      this.pendingTimer = null
      if (!pending) return
      const also =
        pending.also.length > 0 ? ` (also: ${pending.also.join(', ')})` : ''
      const detailText = `${pending.detail ?? ''}${also}`.trim()
      this.capture(pending.trigger, detailText || undefined, pending.severity)
    }, ANOMALY_CONFIG.SETTLE_MS)
    return true
  }

  /**
   * Track an ongoing unhealthy condition. Reports `key` when it becomes
   * active (after `sustainMs`, if given, so brief blips are ignored),
   * 'recovered' when it clears, and 'still_unhealthy' periodically while any
   * condition stays active.
   */
  setCondition(
    key: string,
    active: boolean,
    detail?: string,
    options: { sustainMs?: number; severity?: SnapshotSeverity } = {}
  ): void {
    const existing = this.conditions.get(key)

    if (!active) {
      if (!existing) return
      this.conditions.delete(key)
      if (existing.timer !== null) this.clearTimer(existing.timer)
      if (existing.active) {
        this.report('recovered', key, 'info', `recovered:${key}`)
        this.updateStillUnhealthyTimer()
      }
      return
    }

    if (existing) {
      existing.detail = detail
      return
    }

    const state: ConditionState = { detail, active: false, timer: null }
    this.conditions.set(key, state)
    const activate = (): void => {
      state.timer = null
      state.active = true
      this.report(key, state.detail, options.severity ?? 'error')
      this.updateStillUnhealthyTimer()
    }
    if (options.sustainMs && options.sustainMs > 0) {
      state.timer = this.setTimer(activate, options.sustainMs)
    } else {
      activate()
    }
  }

  /** Stop tracking a condition without reporting a recovery. */
  clearCondition(key: string): void {
    const existing = this.conditions.get(key)
    if (!existing) return
    this.conditions.delete(key)
    if (existing.timer !== null) this.clearTimer(existing.timer)
    this.updateStillUnhealthyTimer()
  }

  /** Feed every log line through here. */
  observeLog(entry: ObservedLog): void {
    if (entry.level === 'INFO') return

    const text = `${entry.context ? `[${entry.context}] ` : ''}${entry.message}`
    const detail = text.slice(0, 300)

    if (REALTIME_DOWN_PATTERN.test(entry.message)) {
      this.report('realtime_down', detail, 'warning')
    }

    if (entry.level === 'ERROR') {
      this.report(
        entry.context === 'Window' ? 'uncaught_error' : 'error_log',
        detail,
        'error'
      )
      return
    }

    const now = this.now()
    this.warnTimes = this.warnTimes.filter(
      (at) => now - at < ANOMALY_CONFIG.WARN_BURST_WINDOW_MS
    )
    this.warnTimes.push(now)
    if (this.warnTimes.length >= ANOMALY_CONFIG.WARN_BURST_COUNT) {
      this.warnTimes = []
      this.report('warn_burst', detail, 'warning')
    }
  }

  dispose(): void {
    if (this.pendingTimer !== null) this.clearTimer(this.pendingTimer)
    if (this.stillUnhealthyTimer !== null) {
      this.clearTimer(this.stillUnhealthyTimer)
    }
    this.conditions.forEach((state) => {
      if (state.timer !== null) this.clearTimer(state.timer)
    })
    this.conditions.clear()
    this.pending = null
    this.pendingTimer = null
    this.stillUnhealthyTimer = null
  }

  private hasBudget(trigger: string, priority: boolean): boolean {
    const sameClass = this.captures.filter((c) => c.priority === priority)
    if (priority) {
      return sameClass.length < ANOMALY_CONFIG.MAX_PRIORITY_SNAPSHOTS_PER_HOUR
    }
    if (sameClass.length >= ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR) return false
    const sameTrigger = sameClass.filter((c) => c.trigger === trigger).length
    const cap = NOISY_TRIGGERS.has(trigger)
      ? ANOMALY_CONFIG.MAX_PER_NOISY_TRIGGER_PER_HOUR
      : ANOMALY_CONFIG.MAX_PER_TRIGGER_PER_HOUR
    return sameTrigger < cap
  }

  private activeConditionKeys(): string[] {
    const keys: string[] = []
    this.conditions.forEach((state, key) => {
      if (state.active) keys.push(key)
    })
    return keys
  }

  private updateStillUnhealthyTimer(): void {
    const anyActive = this.activeConditionKeys().length > 0
    if (!anyActive) {
      if (this.stillUnhealthyTimer !== null) {
        this.clearTimer(this.stillUnhealthyTimer)
        this.stillUnhealthyTimer = null
      }
      return
    }
    if (this.stillUnhealthyTimer !== null) return

    const tick = (): void => {
      this.stillUnhealthyTimer = null
      const keys = this.activeConditionKeys()
      if (keys.length === 0) return
      this.report('still_unhealthy', keys.join(', '), 'error')
      this.stillUnhealthyTimer = this.setTimer(
        tick,
        ANOMALY_CONFIG.STILL_UNHEALTHY_MS
      )
    }
    this.stillUnhealthyTimer = this.setTimer(
      tick,
      ANOMALY_CONFIG.STILL_UNHEALTHY_MS
    )
  }
}
