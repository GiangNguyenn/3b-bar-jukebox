/**
 * Unit tests for AnomalyDetector: which events produce a diagnostic
 * snapshot, and the limits that keep snapshots from flooding storage.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AnomalyDetector, ANOMALY_CONFIG } from '../anomalyDetector'

interface Captured {
  trigger: string
  detail: string | undefined
  severity: string
}

interface Harness {
  detector: AnomalyDetector
  captured: Captured[]
  advance: (ms: number) => void
}

// A manual clock: timers only fire when the test advances time
function createHarness(): Harness {
  let now = 1_000_000
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const captured: Captured[] = []

  const detector = new AnomalyDetector({
    capture: (trigger, detail, severity) => {
      captured.push({ trigger, detail, severity })
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    }
  })

  const advance = (ms: number): void => {
    const target = now + ms
    for (;;) {
      let nextTimer: { id: number; at: number; fn: () => void } | null = null
      timers.forEach((timer, id) => {
        if (timer.at <= target && (!nextTimer || timer.at < nextTimer.at)) {
          nextTimer = { id, ...timer }
        }
      })
      if (!nextTimer) break
      const due = nextTimer as { id: number; at: number; fn: () => void }
      timers.delete(due.id)
      now = due.at
      due.fn()
    }
    now = target
  }

  return { detector, captured, advance }
}

const SETTLE = ANOMALY_CONFIG.SETTLE_MS
const COOLDOWN = ANOMALY_CONFIG.COOLDOWN_MS

void describe('AnomalyDetector', () => {
  void it('captures a snapshot a few seconds after a trigger', () => {
    const { detector, captured, advance } = createHarness()

    detector.report('recovery_attempt', 'device lost')
    assert.equal(captured.length, 0)

    advance(SETTLE)
    assert.deepEqual(captured, [
      { trigger: 'recovery_attempt', detail: 'device lost', severity: 'error' }
    ])
  })

  void it('merges triggers that land together into one snapshot', () => {
    const { detector, captured, advance } = createHarness()

    detector.report('warn_burst', 'lots of warnings', 'warning')
    detector.report('error_log', 'playback failed', 'error')
    detector.report('offline', 'no network', 'error')
    advance(SETTLE)

    assert.equal(captured.length, 1)
    assert.equal(captured[0].trigger, 'warn_burst')
    assert.equal(
      captured[0].detail,
      'lots of warnings (also: error_log, offline)'
    )
    // The merged snapshot carries the most severe level
    assert.equal(captured[0].severity, 'error')
  })

  void it('suppresses the same trigger during its cooldown', () => {
    const { detector, captured, advance } = createHarness()

    assert.equal(detector.report('error_log', 'first'), true)
    advance(SETTLE)
    assert.equal(detector.report('error_log', 'second'), false)
    advance(COOLDOWN)
    assert.equal(detector.report('error_log', 'third'), true)
    advance(SETTLE)

    assert.deepEqual(
      captured.map((c) => c.detail),
      ['first', 'third']
    )
  })

  void it('caps snapshots per hour', () => {
    const { detector, captured, advance } = createHarness()

    for (let i = 0; i < ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR + 5; i++) {
      detector.report(`trigger_${i}`)
      advance(SETTLE)
    }
    assert.equal(captured.length, ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR)

    advance(60 * 60_000)
    detector.report('after_the_hour')
    advance(SETTLE)
    assert.equal(captured.length, ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR + 1)
  })

  void it('keeps a separate budget for triggers that mean playback broke', () => {
    const { detector, captured, advance } = createHarness()

    // Routine triggers use up their whole hourly budget...
    for (let i = 0; i < ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR + 5; i++) {
      detector.report(`trigger_${i}`)
      advance(SETTLE)
    }
    assert.equal(captured.length, ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR)

    // ...and the snapshot for a lost device is still taken
    assert.equal(detector.report('recovery_attempt', 'device lost'), true)
    advance(SETTLE)
    assert.equal(captured[captured.length - 1].trigger, 'recovery_attempt')

    for (
      let i = 0;
      i < ANOMALY_CONFIG.MAX_PRIORITY_SNAPSHOTS_PER_HOUR + 5;
      i++
    ) {
      advance(COOLDOWN)
      detector.report('playback_stopped', `silence ${i}`)
      advance(SETTLE)
    }
    assert.equal(
      captured.length,
      ANOMALY_CONFIG.MAX_SNAPSHOTS_PER_HOUR +
        ANOMALY_CONFIG.MAX_PRIORITY_SNAPSHOTS_PER_HOUR
    )
  })

  void it('limits how many snapshots a noisy trigger may take per hour', () => {
    const { detector, captured, advance } = createHarness()

    for (let i = 0; i < 8; i++) {
      detector.report('warn_burst', `burst ${i}`, 'warning')
      advance(COOLDOWN)
    }
    assert.equal(captured.length, ANOMALY_CONFIG.MAX_PER_NOISY_TRIGGER_PER_HOUR)

    // The rest of the routine budget is still there for other triggers
    assert.equal(detector.report('offline', 'no network'), true)
  })

  void it('files a merged snapshot under the priority trigger', () => {
    const { detector, captured, advance } = createHarness()

    detector.report('warn_burst', 'lots of warnings', 'warning')
    detector.report('recovery_attempt', 'device lost', 'error')
    advance(SETTLE)

    assert.deepEqual(captured, [
      {
        trigger: 'recovery_attempt',
        detail: 'device lost (also: warn_burst)',
        severity: 'error'
      }
    ])
  })

  void it('reports a condition when it starts and when it recovers', () => {
    const { detector, captured, advance } = createHarness()

    detector.setCondition('health_error', true, 'device disconnected')
    advance(SETTLE)
    detector.setCondition('health_error', false)
    advance(SETTLE)

    assert.deepEqual(
      captured.map((c) => [c.trigger, c.detail, c.severity]),
      [
        ['health_error', 'device disconnected', 'error'],
        ['recovered', 'health_error', 'info']
      ]
    )
  })

  void it('ignores a condition that clears before its sustain time', () => {
    const { detector, captured, advance } = createHarness()

    detector.setCondition('player_stuck', true, 'reconnecting', {
      sustainMs: 30_000
    })
    advance(20_000)
    detector.setCondition('player_stuck', false)
    advance(60_000)

    assert.equal(captured.length, 0)
  })

  void it('reports a sustained condition with its latest detail', () => {
    const { detector, captured, advance } = createHarness()

    detector.setCondition('player_stuck', true, 'reconnecting', {
      sustainMs: 30_000
    })
    advance(10_000)
    detector.setCondition('player_stuck', true, 'error: device gone', {
      sustainMs: 30_000
    })
    advance(20_000 + SETTLE)

    assert.deepEqual(
      captured.map((c) => [c.trigger, c.detail]),
      [['player_stuck', 'error: device gone']]
    )
  })

  void it('re-reports periodically while a condition persists', () => {
    const { detector, captured, advance } = createHarness()

    detector.setCondition('health_error', true, 'token error')
    advance(ANOMALY_CONFIG.STILL_UNHEALTHY_MS * 2 + SETTLE)

    assert.deepEqual(
      captured.map((c) => c.trigger),
      ['health_error', 'still_unhealthy', 'still_unhealthy']
    )
    assert.equal(captured[1].detail, 'health_error')

    detector.setCondition('health_error', false)
    advance(ANOMALY_CONFIG.STILL_UNHEALTHY_MS * 2)
    assert.deepEqual(
      captured.map((c) => c.trigger),
      ['health_error', 'still_unhealthy', 'still_unhealthy', 'recovered']
    )
  })

  void it('clears a condition silently when asked to', () => {
    const { detector, captured, advance } = createHarness()

    detector.setCondition('health_error', true, 'token error')
    advance(SETTLE)
    detector.clearCondition('health_error')
    advance(ANOMALY_CONFIG.STILL_UNHEALTHY_MS * 2)

    assert.deepEqual(
      captured.map((c) => c.trigger),
      ['health_error']
    )
  })

  void it('triggers on an ERROR log line', () => {
    const { detector, captured, advance } = createHarness()

    detector.observeLog({
      level: 'ERROR',
      context: 'PlaybackHealth',
      message: 'Playback stalled'
    })
    advance(SETTLE)

    assert.deepEqual(captured, [
      {
        trigger: 'error_log',
        detail: '[PlaybackHealth] Playback stalled',
        severity: 'error'
      }
    ])
  })

  void it('labels uncaught errors separately', () => {
    const { detector, captured, advance } = createHarness()

    detector.observeLog({
      level: 'ERROR',
      context: 'Window',
      message: 'Uncaught error: x is undefined'
    })
    advance(SETTLE)

    assert.equal(captured[0].trigger, 'uncaught_error')
  })

  void it('triggers on a burst of WARN lines but not on a few', () => {
    const { detector, captured, advance } = createHarness()

    for (let i = 0; i < ANOMALY_CONFIG.WARN_BURST_COUNT - 1; i++) {
      detector.observeLog({ level: 'WARN', message: `warning ${i}` })
    }
    advance(SETTLE)
    assert.equal(captured.length, 0)

    detector.observeLog({ level: 'WARN', message: 'one more' })
    advance(SETTLE)
    assert.deepEqual(
      captured.map((c) => [c.trigger, c.severity]),
      [['warn_burst', 'warning']]
    )
  })

  void it('does not count WARN lines spread over a long time as a burst', () => {
    const { detector, captured, advance } = createHarness()

    for (let i = 0; i < ANOMALY_CONFIG.WARN_BURST_COUNT * 2; i++) {
      detector.observeLog({ level: 'WARN', message: `warning ${i}` })
      advance(ANOMALY_CONFIG.WARN_BURST_WINDOW_MS / 2)
    }

    assert.equal(captured.length, 0)
  })

  void it('ignores INFO lines', () => {
    const { detector, captured, advance } = createHarness()

    for (let i = 0; i < 50; i++) {
      detector.observeLog({ level: 'INFO', message: 'Playback paused' })
    }
    advance(SETTLE)

    assert.equal(captured.length, 0)
  })

  void it('flags a realtime channel failure', () => {
    const { detector, captured, advance } = createHarness()

    detector.observeLog({
      level: 'WARN',
      context: 'useNowPlayingRealtime',
      message: 'CHANNEL_ERROR — reconnecting in 2000ms (attempt 1)'
    })
    advance(SETTLE)

    assert.equal(captured[0].trigger, 'realtime_down')
  })
})
